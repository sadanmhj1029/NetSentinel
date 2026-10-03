import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./store/AuthContext";
import { LiveProvider } from "./store/LiveContext";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { TopologyPage } from "./pages/TopologyPage";
import { IncidentsPage } from "./pages/IncidentsPage";
import { IncidentDetailPage } from "./pages/IncidentDetailPage";
import { DevicesPage } from "./pages/DevicesPage";
import { DeviceDetailPage } from "./pages/DeviceDetailPage";
import { ScenariosPage } from "./pages/ScenariosPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { MlAdminPage } from "./pages/MlAdminPage";
import { AuditPage } from "./pages/AuditPage";
import { UsersPage } from "./pages/UsersPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LiveProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route index element={<DashboardPage />} />
                <Route path="topology" element={<TopologyPage />} />
                <Route path="incidents" element={<IncidentsPage />} />
                <Route path="incidents/:incidentId" element={<IncidentDetailPage />} />
                <Route path="devices" element={<DevicesPage />} />
                <Route path="devices/:deviceId" element={<DeviceDetailPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="settings" element={<SettingsPage />} />

                <Route element={<ProtectedRoute minRole="operator" />}>
                  <Route path="scenarios" element={<ScenariosPage />} />
                </Route>

                <Route element={<ProtectedRoute minRole="admin" />}>
                  <Route path="ml" element={<MlAdminPage />} />
                  <Route path="audit" element={<AuditPage />} />
                  <Route path="users" element={<UsersPage />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </LiveProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
