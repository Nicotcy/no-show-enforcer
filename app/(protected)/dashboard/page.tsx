import AppNav from "../../components/AppNav";
import DashboardClient from "./DashboardClient";

export default function DashboardPage() {
  return (
    <div>
      <AppNav />
      <div style={{ padding: 24 }}>
        <h1>Appointments</h1>
        <DashboardClient />
      </div>
    </div>
  );
}
