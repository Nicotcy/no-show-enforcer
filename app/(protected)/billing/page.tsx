import AppNav from "../../components/AppNav";
import BillingClient from "./BillingClient";

export default function BillingPage() {
  return (
    <div>
      <AppNav />
      <div style={{ padding: 24 }}>
        <h1>Billing</h1>
        <BillingClient />
      </div>
    </div>
  );
}
