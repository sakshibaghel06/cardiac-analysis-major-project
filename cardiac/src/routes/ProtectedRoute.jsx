import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../context/useAuth";

/*
=====================================================
PROTECTED ROUTE
=====================================================

Usage:

    <ProtectedRoute>            signed in, any role
    <ProtectedRoute role="doctor">
    <ProtectedRoute role="patient">

This is a convenience and a UX guard, not the security
boundary. The real boundary is firestore.rules - a user
who forces their way to a doctor URL still cannot read a
single document they are not entitled to.
=====================================================
*/

function ProtectedRoute({ children, role }) {
  const { user, role: actualRole, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="route-loading">
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    /*
      Bounce to the portal that matches the page they were trying
      to reach, and remember where they were going so login can
      return them once the role is resolved.

      This is a convenience only - the portal does not grant the
      role, so sending a patient to the doctor portal would be
      harmless, merely confusing.
    */
    const portal = location.pathname.startsWith("/doctor")
      ? "/doctor/login"
      : "/login";

    return (
      <Navigate to={portal} state={{ from: location.pathname }} replace />
    );
  }

  if (role && actualRole !== role) {
    /*
      Signed in, wrong role. Send them to their own home rather
      than to a login page they are already past.
    */
    return (
      <Navigate
        to={actualRole === "doctor" ? "/doctor/dashboard" : "/patient/dashboard"}
        replace
      />
    );
  }

  return children;
}

export default ProtectedRoute;
