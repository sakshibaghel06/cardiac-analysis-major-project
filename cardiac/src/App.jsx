import { Routes, Route, Navigate } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./routes/ProtectedRoute";

import Landing from "./auth/Landing";
import Login from "./auth/Login";
import Signup from "./auth/Signup";

import PatientDashboard from "./dashboard/PatientDashboard";
import RiskAssessment from "./dashboard/RiskAssessment";

import Result from "./pages/Result";
import ConsultDoctor from "./pages/ConsultDoctor";
import ConsultationStatus from "./pages/ConsultationStatus";
import ConsultationHistory from "./pages/ConsultationHistory";
import Prescription from "./pages/Prescription";
import VideoConsultation from "./pages/VideoConsultation";
import Emergency from "./pages/Emergency";
import Payment from "./pages/Payment";
import PatientProfile from "./pages/PatientProfile";

import DoctorDashboard from "./doctor/DoctorDashboard";
import DoctorRequest from "./doctor/DoctorRequest";
import DoctorProfile from "./doctor/DoctorProfile";

/*
=====================================================
ROUTES
=====================================================

Every route that touches patient data is wrapped in
ProtectedRoute. Previously only the doctor dashboard
checked authentication, so signed-out users could open
the risk form, the result page and the consultation flow
and only hit an error deep inside a Firestore call.

ProtectedRoute is a UX guard. The security boundary is
firestore.rules.
=====================================================
*/

function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* ---------- public ---------- */}

        {/*
          Two clearly separated entry points, but the split is
          PRESENTATIONAL ONLY: both portals run the same sign-in and
          the same Firestore role resolution, and the role decides
          the destination. Picking a portal grants nothing.
        */}
        <Route path="/" element={<Landing />} />

        <Route path="/login" element={<Login portal="patient" />} />
        <Route path="/doctor/login" element={<Login portal="doctor" />} />

        <Route path="/signup" element={<Signup />} />

        {/* ---------- patient ---------- */}

        <Route
          path="/patient/dashboard"
          element={
            <ProtectedRoute>
              <PatientDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/risk"
          element={
            <ProtectedRoute>
              <RiskAssessment />
            </ProtectedRoute>
          }
        />

        <Route
          path="/result"
          element={
            <ProtectedRoute>
              <Result />
            </ProtectedRoute>
          }
        />

        {/*
          Emergency information. Reachable from a high-risk result,
          from reported emergency symptoms, and from the dashboard.
        */}
        <Route
          path="/profile"
          element={
            <ProtectedRoute role="patient">
              <PatientProfile />
            </ProtectedRoute>
          }
        />

        <Route
          path="/emergency"
          element={
            <ProtectedRoute>
              <Emergency />
            </ProtectedRoute>
          }
        />

        <Route
          path="/consult-doctor"
          element={
            <ProtectedRoute>
              <ConsultDoctor />
            </ProtectedRoute>
          }
        />

        <Route
          path="/consultations"
          element={
            <ProtectedRoute>
              <ConsultationHistory />
            </ProtectedRoute>
          }
        />

        <Route
          path="/consultation-status/:requestId"
          element={
            <ProtectedRoute>
              <ConsultationStatus />
            </ProtectedRoute>
          }
        />

        {/*
          Where the patient lands when a call ends: waiting state
          until the doctor issues, then the fee, then unlocked.
        */}
        <Route
          path="/payment/:requestId"
          element={
            <ProtectedRoute role="patient">
              <Payment />
            </ProtectedRoute>
          }
        />

        {/* Shared: the doctor writes it, the patient reads it. */}
        <Route
          path="/prescription/:requestId"
          element={
            <ProtectedRoute>
              <Prescription />
            </ProtectedRoute>
          }
        />

        {/*
          Video consultation deliberately has no role= here.
          The page resolves the role from the consultation record
          itself, so it cannot be spoofed via the URL.
        */}
        <Route
          path="/video-consultation/:requestId"
          element={
            <ProtectedRoute>
              <VideoConsultation />
            </ProtectedRoute>
          }
        />

        {/* ---------- doctor ---------- */}

        <Route
          path="/doctor/dashboard"
          element={
            <ProtectedRoute role="doctor">
              <DoctorDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/doctor/request/:requestId"
          element={
            <ProtectedRoute role="doctor">
              <DoctorRequest />
            </ProtectedRoute>
          }
        />

        <Route
          path="/doctor/profile"
          element={
            <ProtectedRoute role="doctor">
              <DoctorProfile />
            </ProtectedRoute>
          }
        />

        {/*
          The dashboard used to link to these two without them
          existing as routes, so clicking them rendered a blank page.
        */}
        <Route
          path="/doctor/consultations"
          element={<Navigate to="/doctor/dashboard" replace />}
        />

        <Route
          path="/doctor/patients"
          element={<Navigate to="/doctor/dashboard" replace />}
        />

        {/* ---------- fallback ---------- */}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
