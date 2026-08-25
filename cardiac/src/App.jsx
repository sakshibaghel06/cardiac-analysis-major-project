import { Routes, Route } from "react-router-dom";

import Login from "./auth/Login";
import Signup from "./auth/Signup";
import PatientDashboard from "./dashboard/PatientDashboard";
import RiskAssessment from "./dashboard/RiskAssessment";
import Result from "./pages/Result";
import DoctorLogin from "./doctor/DoctorLogin";
import ConsultDoctor from "./pages/ConsultDoctor";
import DoctorDashboard from "./doctor/DoctorDashboard";
import ConsultationStatus from "./pages/ConsultationStatus";
import DoctorRequest from "./doctor/DoctorRequest";
import VideoConsultation from "./pages/VideoConsultation";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />

      <Route
        path="/signup"
        element={<Signup />}
      />
      <Route
        path="/result"
        element={<Result />}
      />

      <Route
         path="/risk"
        element={<RiskAssessment />}
      />

      <Route
        path="/patient/dashboard"
        element={<PatientDashboard />}
      />
      <Route
        path="/doctor/login"
        element={
          <DoctorLogin />
        }
      />
      <Route
        path="/doctor/dashboard"
        element={<DoctorDashboard />}
      />
      <Route
      path="/doctor/request/:requestId"
      element={<DoctorRequest />}
    />
      <Route
      path="/consult-doctor"
      element={<ConsultDoctor />}
    />
   <Route
      path="/consultation-status/:requestId"
      element={<ConsultationStatus />}
    />
    <Route
      path="/video-consultation/:requestId"
      element={<VideoConsultation />}
    />
    </Routes>
  );
}

export default App;