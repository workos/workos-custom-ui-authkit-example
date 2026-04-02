import { Card, Flex, Heading, Spinner } from "@radix-ui/themes";
import { useAuth } from "./hooks/useAuth";
import { LoginView } from "./views/LoginView";
import { MagicCodeView } from "./views/MagicCodeView";
import { OrgPickerView } from "./views/OrgPickerView";
import { DashboardView } from "./views/DashboardView";
import "./app.css";

export default function App() {
  const auth = useAuth();

  if (auth.view === "loading") {
    return (
      <Flex className="page" align="center" justify="center">
        <Card size="3" className="auth-card">
          <Flex align="center" justify="center" gap="3" py="6">
            <Spinner size="3" />
            <Heading size="4">Loading...</Heading>
          </Flex>
        </Card>
      </Flex>
    );
  }

  if (auth.view === "login") {
    return (
      <LoginView
        loginStep={auth.loginStep}
        email={auth.email}
        password={auth.password}
        loading={auth.loading}
        error={auth.error}
        logs={auth.logs}
        onEmailChange={auth.onEmailChange}
        onPasswordChange={auth.setPassword}
        onCheckEmail={auth.checkEmail}
        onLoginWithPassword={auth.loginWithPassword}
        onSendMagicCode={() => auth.sendMagicCode()}
      />
    );
  }

  if (auth.view === "magic-code") {
    return (
      <MagicCodeView
        email={auth.email}
        magicCode={auth.magicCode}
        loading={auth.loading}
        error={auth.error}
        logs={auth.logs}
        onMagicCodeChange={auth.setMagicCode}
        onVerify={auth.verifyMagicCode}
        onBack={auth.goToLogin}
      />
    );
  }

  if (auth.view === "org-picker") {
    return (
      <OrgPickerView
        orgChoices={auth.orgChoices}
        loading={auth.loading}
        error={auth.error}
        logs={auth.logs}
        onSelectOrg={auth.selectOrg}
        onBack={auth.goToLogin}
      />
    );
  }

  // view === "dashboard"
  return (
    <DashboardView
      user={auth.user!}
      orgId={auth.orgId}
      logs={auth.logs}
      onLogout={auth.logout}
    />
  );
}
