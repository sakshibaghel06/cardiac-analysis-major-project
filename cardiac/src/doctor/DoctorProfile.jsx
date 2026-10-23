import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { auth, db } from "../firebase/firebase";
import { useAuth } from "../context/useAuth";
import { resetPassword } from "../services/authService";

/*
=====================================================
DOCTOR PROFILE AND AVAILABILITY
=====================================================

Two things live here:

  1. The professional details that appear to patients
     choosing a doctor, and that are copied onto every
     prescription this doctor issues.

  2. The availability switch. Turning it off removes this
     doctor from the patient's selection list without
     deleting anything or affecting consultations already
     in progress.

What is deliberately NOT editable:

  hospitalId / hospitalName
      Which hospital a doctor practises at is an
      administrative fact, not a self-service setting.
      Letting a doctor reassign themselves would let them
      appear under a hospital they have no connection to.

  email
      Tied to the Firebase Auth account.

The security rules allow a doctor to update only their own
doctors/{uid} document, so one doctor can never edit
another's fee, availability or credentials.
=====================================================
*/

function DoctorProfile() {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();

  const [name, setName] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [experience, setExperience] = useState("");
  const [fee, setFee] = useState("");
  const [available, setAvailable] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [resetNotice, setResetNotice] = useState("");

  /*
    Seed the form from the profile once it loads, and re-seed after
    refreshProfile(). Adjusted during render rather than in an
    effect - see the note in PatientProfile for why.
  */
  const [seededFrom, setSeededFrom] = useState(null);

  if (profile && profile !== seededFrom) {
    setSeededFrom(profile);

    setName(profile.name || "");
    setSpecialization(profile.specialization || "");

    setExperience(
      profile.experience === undefined || profile.experience === null
        ? ""
        : String(profile.experience)
    );

    setFee(
      profile.consultationFee === undefined ||
        profile.consultationFee === null
        ? ""
        : String(profile.consultationFee)
    );

    // Absent means available - only an explicit false hides a doctor.
    setAvailable(profile.available !== false);
  }

  const save = async (patch, { announce = true } = {}) => {
    setError("");
    setSaved(false);

    try {
      setSaving(true);

      await updateDoc(doc(db, "doctors", user.uid), {
        ...patch,
        updatedAt: serverTimestamp(),
      });

      await refreshProfile();

      if (announce) setSaved(true);

      return true;
    } catch (saveError) {
      console.error(saveError);

      setError(
        saveError?.code === "permission-denied"
          ? "You can only edit your own profile."
          : "Could not save your profile. Please try again."
      );

      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();

    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }

    if (!specialization.trim()) {
      setError("Please enter your speciality.");
      return;
    }

    const feeValue = Number(fee);

    if (!Number.isFinite(feeValue) || feeValue < 0 || feeValue > 100000) {
      setError("Enter a consultation fee between 0 and 100000.");
      return;
    }

    const experienceValue = experience.trim() === "" ? null : Number(experience);

    if (
      experienceValue !== null &&
      (!Number.isFinite(experienceValue) ||
        experienceValue < 0 ||
        experienceValue > 70)
    ) {
      setError("Enter years of experience between 0 and 70.");
      return;
    }

    await save({
      name: name.trim(),
      specialization: specialization.trim(),
      consultationFee: feeValue,
      ...(experienceValue === null ? {} : { experience: experienceValue }),
    });
  };

  const toggleAvailability = async () => {
    const next = !available;

    if (!next) {
      const confirmed = window.confirm(
        "Mark yourself unavailable?\n\n" +
          "Patients will not be able to select you for new consultations. " +
          "Consultations you have already accepted are unaffected."
      );

      if (!confirmed) return;
    }

    // Optimistic, then reconciled by refreshProfile inside save().
    setAvailable(next);

    const ok = await save({ available: next }, { announce: false });

    if (!ok) setAvailable(!next);
  };

  const handlePasswordReset = async () => {
    setError("");
    setResetNotice("");

    try {
      await resetPassword(auth.currentUser.email);

      setResetNotice("A password reset link has been sent to your email.");
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
            <span className="profile-eyebrow">DOCTOR</span>
            <h1>My Profile</h1>
            <p>
              These details are shown to patients choosing a doctor, and
              appear on every prescription you issue.
            </p>
          </div>

          <button
            className="profile-secondary"
            onClick={() => navigate("/doctor/dashboard")}
          >
            Back to Dashboard
          </button>
        </header>

        {/* ==========================================
            AVAILABILITY
        ========================================== */}

        <section
          className={`profile-card profile-availability ${
            available ? "on" : "off"
          }`}
        >
          <div>
            <h2>Availability</h2>

            <p className="profile-muted">
              {available
                ? "You are accepting new consultation requests."
                : "You are hidden from patient search. Existing consultations are unaffected."}
            </p>
          </div>

          <button
            type="button"
            className={`profile-toggle ${available ? "on" : "off"}`}
            onClick={toggleAvailability}
            disabled={saving}
            role="switch"
            aria-checked={available}
          >
            <span className="profile-toggle-track" aria-hidden="true">
              <span className="profile-toggle-thumb" />
            </span>

            {available ? "Available" : "Unavailable"}
          </button>
        </section>

        {/* ==========================================
            PROFESSIONAL DETAILS
        ========================================== */}

        <form className="profile-card" onSubmit={handleSave} noValidate>
          <h2>Professional details</h2>

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
            <span>Speciality</span>

            <input
              value={specialization}
              onChange={(event) => setSpecialization(event.target.value)}
              placeholder="e.g. Cardiologist"
              required
            />
          </label>

          <div className="profile-grid">
            <label className="profile-field">
              <span>
                Years of experience <em>optional</em>
              </span>

              <input
                type="number"
                min={0}
                max={70}
                value={experience}
                onChange={(event) => setExperience(event.target.value)}
              />
            </label>

            <label className="profile-field">
              <span>Consultation fee (Rs)</span>

              <input
                type="number"
                min={0}
                max={100000}
                value={fee}
                onChange={(event) => setFee(event.target.value)}
                required
              />
            </label>
          </div>

          <label className="profile-field">
            <span>
              Hospital <em>set by your administrator</em>
            </span>

            <input
              value={profile?.hospitalName || "Not assigned"}
              disabled
              readOnly
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
            <button type="submit" disabled={saving}>
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
      </div>
    </div>
  );
}

export default DoctorProfile;
