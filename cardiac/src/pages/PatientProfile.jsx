import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { auth, db } from "../firebase/firebase";
import { useAuth } from "../context/useAuth";
import { resetPassword } from "../services/authService";

/*
=====================================================
PATIENT PROFILE
=====================================================

The profile document was created at signup but there was
no way to see or edit it.

Only fields the patient genuinely owns are editable. role
is NOT among them - the security rules reject any update
that changes it, and there is no control here that could
attempt one.

Deliberately minimal: this collects a name and an optional
phone number, nothing more. Health information lives in
risk_assessments where it belongs, and collecting personal
details the application has no use for would be a liability
rather than a feature.
=====================================================
*/

function PatientProfile() {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [resetNotice, setResetNotice] = useState("");

  /*
    Seed the form from the profile once it loads, and re-seed if it
    is refreshed from elsewhere.

    Adjusting state during render rather than in an effect is the
    pattern React documents for this: an effect would render once
    with empty fields and again with the real values, which the
    user sees as a flicker.
  */
  const [seededFrom, setSeededFrom] = useState(null);

  if (profile && profile !== seededFrom) {
    setSeededFrom(profile);
    setName(profile.name || "");
    setPhone(profile.phone || "");
  }

  const dirty =
    name !== (profile?.name || "") || phone !== (profile?.phone || "");

  const handleSave = async (event) => {
    event.preventDefault();

    setError("");
    setSaved(false);

    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }

    /*
      Loose on purpose. Phone formats vary by country and a
      strict pattern rejects more valid numbers than invalid
      ones. It is optional, and nothing depends on it.
    */
    if (phone.trim() && !/^[0-9+\-\s()]{6,20}$/.test(phone.trim())) {
      setError("That phone number does not look right.");
      return;
    }

    try {
      setSaving(true);

      await updateDoc(doc(db, "users", user.uid), {
        name: name.trim(),
        phone: phone.trim(),
        updatedAt: serverTimestamp(),
      });

      await refreshProfile();

      setSaved(true);
    } catch (saveError) {
      console.error(saveError);

      setError(
        saveError?.code === "permission-denied"
          ? "You do not have permission to change this profile."
          : "Could not save your profile. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordReset = async () => {
    setError("");
    setResetNotice("");

    try {
      await resetPassword(auth.currentUser.email);

      setResetNotice(
        "A password reset link has been sent to your email address."
      );
    } catch {
      setError("Could not send a reset email. Please try again shortly.");
    }
  };

  if (authLoading) {
    return (
      <div className="profile-page">
        <div className="profile-shell">
          <p className="profile-loading">Loading your profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <div className="profile-shell">
        <header className="profile-header">
          <div>
            <span className="profile-eyebrow">PATIENT</span>
            <h1>My Profile</h1>
            <p>Your account details. Health data is kept separately.</p>
          </div>

          <button
            className="profile-secondary"
            onClick={() => navigate("/patient/dashboard")}
          >
            Back to Dashboard
          </button>
        </header>

        <form className="profile-card" onSubmit={handleSave} noValidate>
          <h2>Personal details</h2>

          <label className="profile-field">
            <span>Full name</span>

            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
            />
          </label>

          <label className="profile-field">
            <span>
              Phone number <em>optional</em>
            </span>

            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="tel"
              inputMode="tel"
              placeholder="e.g. +91 98765 43210"
            />
          </label>

          <label className="profile-field">
            <span>
              Email <em>cannot be changed here</em>
            </span>

            <input value={user?.email || ""} disabled readOnly />
          </label>

          {error && (
            <div className="profile-error" role="alert">
              {error}
            </div>
          )}

          {saved && (
            <div className="profile-success" role="status">
              Your profile has been updated.
            </div>
          )}

          <div className="profile-actions">
            <button type="submit" disabled={saving || !dirty}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>

        <section className="profile-card">
          <h2>Security</h2>

          <p className="profile-muted">
            We will email you a link to choose a new password.
          </p>

          {resetNotice && (
            <div className="profile-success" role="status">
              {resetNotice}
            </div>
          )}

          <div className="profile-actions">
            <button
              type="button"
              className="profile-secondary"
              onClick={handlePasswordReset}
            >
              Send Password Reset Email
            </button>
          </div>
        </section>

        <section className="profile-card profile-privacy">
          <h2>Your health data</h2>

          <p className="profile-muted">
            Your cardiac assessments are stored separately from this
            profile and are visible only to you, and to a doctor whose
            consultation you have requested and who has accepted it.
            Declining or cancelling a consultation removes that access.
          </p>
        </section>
      </div>
    </div>
  );
}

export default PatientProfile;
