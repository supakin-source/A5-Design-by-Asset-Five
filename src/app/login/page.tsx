import { Suspense } from "react";
import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <div className="shell">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
