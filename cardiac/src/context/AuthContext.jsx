import { useCallback, useEffect, useMemo, useState } from "react";

import { onAuthStateChanged, signOut } from "firebase/auth";

import { auth } from "../firebase/firebase";
import { resolveRole } from "../services/roleService";
import { AuthContext } from "./authContextObject";

/*
=====================================================
AUTH PROVIDER
=====================================================

One place that knows:

  - is someone signed in?
  - are they a patient or a doctor?
  - what is their profile (name, hospital, fee...)?

Role is resolved from Firestore by roleService, never
from the URL and never from anything the user can edit.
It applies the SAME test the security rules do, so the UI
and the database always agree about who is a doctor.

Carrying the profile here means a screen can show the
patient's real name, or the doctor's hospital, without a
second round trip - which is what replaces the hardcoded
names the dashboards used to display.

Before this existed, only DoctorDashboard checked auth at
all. Every other screen rendered for signed-out users and
only failed later, deep inside a Firestore call.
=====================================================
*/

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (signedInUser) => {
      if (!signedInUser) {
        setUser(null);
        setRole(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      setUser(signedInUser);

      try {
        const resolved = await resolveRole(signedInUser);

        setRole(resolved.role);
        setProfile(resolved.profile);
      } catch (error) {
        console.error("Could not resolve role:", error);

        // Fail closed: assume the lower privilege.
        setRole("patient");
        setProfile(null);
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  /*
    Lets a screen refresh the cached profile after an edit
    without forcing a sign-out and back in.
  */
  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) return;

    const resolved = await resolveRole(auth.currentUser);

    setRole(resolved.role);
    setProfile(resolved.profile);
  }, []);

  const value = useMemo(
    () => ({
      user,
      role,
      profile,
      loading,

      isDoctor: role === "doctor",
      isPatient: role === "patient",

      // Never a hardcoded name - falls back through real values only.
      displayName:
        profile?.name || user?.displayName || user?.email?.split("@")[0] || "",

      refreshProfile,
      logout: () => signOut(auth),
    }),
    [user, role, profile, loading, refreshProfile]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}
