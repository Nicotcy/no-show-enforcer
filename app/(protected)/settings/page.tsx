import AppNav from "../../components/AppNav";
import SettingsClient from "./SettingsClient";

export default function SettingsPage() {
  return (
    <div>
      <AppNav />
      <div style={{ padding: 24, maxWidth: 520 }}>
        <h1>Settings</h1>
        <SettingsClient />
      </div>
    </div>
  );
}
