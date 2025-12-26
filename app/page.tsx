import { redirect } from "next/navigation";

export default function HomePage() {
  // La home NO muestra contenido.
  // Simplemente redirige al login.
  redirect("/login");
}
