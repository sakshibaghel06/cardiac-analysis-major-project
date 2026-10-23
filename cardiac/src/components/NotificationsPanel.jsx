import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  countUnread,
  isUnread,
  markNotificationsSeen,
  relativeTime,
} from "../services/notificationService";

/*
=====================================================
NOTIFICATIONS PANEL
=====================================================

One component, both dashboards. Takes an already-derived
list (see notificationService) so it does no fetching of
its own and cannot show anything the caller was not
already authorised to read.

Accessibility: the trigger is a real button with
aria-expanded, the panel closes on Escape and on an
outside click, and focus returns to the trigger - so it
is usable without a mouse.
=====================================================
*/

function NotificationsPanel({ items = [], lastSeenAt, role, onSeen }) {
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  const unread = countUnread(items, lastSeenAt);

  // ---------------------------------------------------
  // CLOSE ON OUTSIDE CLICK / ESCAPE
  // ---------------------------------------------------

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };

    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;

      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = async () => {
    const next = !open;

    setOpen(next);

    /*
      Opening the panel IS reading them. Record it so the badge
      clears, and let the parent refresh its own copy.
    */
    if (next && unread > 0) {
      await markNotificationsSeen(role);
      onSeen?.();
    }
  };

  const follow = (item) => {
    setOpen(false);

    if (item.route) navigate(item.route);
  };

  return (
    <div className="notif" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="notif-trigger"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={
          unread > 0
            ? `Notifications, ${unread} unread`
            : "Notifications, none unread"
        }
      >
        <span aria-hidden="true">🔔</span>

        {unread > 0 && (
          <span className="notif-badge" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-panel" role="region" aria-label="Notifications">
          <header className="notif-head">
            <h2>Notifications</h2>

            <span className="notif-count">
              {items.length === 0
                ? "Nothing yet"
                : `${items.length} total`}
            </span>
          </header>

          {items.length === 0 ? (
            <div className="notif-empty">
              <p>
                You have no notifications. Updates about your consultations
                will appear here.
              </p>
            </div>
          ) : (
            <ul className="notif-list">
              {items.slice(0, 20).map((item) => (
                <li
                  key={item.id}
                  className={[
                    "notif-item",
                    isUnread(item, lastSeenAt) ? "unread" : "",
                    item.urgent ? "urgent" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button type="button" onClick={() => follow(item)}>
                    <strong>{item.title}</strong>

                    <span className="notif-body">{item.body}</span>

                    <span className="notif-time">{relativeTime(item.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationsPanel;
