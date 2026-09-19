import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/RegisterForm";

export default async function RegisterPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (session.user.profileComplete) redirect("/profile");

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">регистрация</p>
        <h1>Профиль</h1>
        <p className="lead">
          Steam уже подтверждён
          {session.user.steamName ? ` (${session.user.steamName})` : ""}.
          Заполни ник, имя и дату рождения.
        </p>
      </section>
      <RegisterForm />
    </main>
  );
}
