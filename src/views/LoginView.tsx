import { type FormEvent } from 'react';
import { Box, Button, Card, Flex, Heading, Separator, Spinner, Text, TextField } from '@radix-ui/themes';
import type { LogEntry, LoginStep } from '../types';
import { ErrorCallout } from '../components/ErrorCallout';
import { LogPanel } from '../components/LogPanel';

interface Props {
  loginStep: LoginStep;
  email: string;
  password: string;
  loading: string | false;
  error: string;
  logs: LogEntry[];
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onCheckEmail: (e: FormEvent) => void;
  onLoginWithPassword: (e: FormEvent) => void;
  onSendMagicCode: () => void;
}

export function LoginView({
  loginStep,
  email,
  password,
  loading,
  error,
  logs,
  onEmailChange,
  onPasswordChange,
  onCheckEmail,
  onLoginWithPassword,
  onSendMagicCode,
}: Props) {
  const isEmailStep = loginStep === 'email';

  return (
    <div className="page">
      <Card size="3" className="auth-card">
        <Heading size="5" align="center" mb="5">
          Sign In
        </Heading>
        {error && <ErrorCallout message={error} />}

        <form onSubmit={isEmailStep ? onCheckEmail : onLoginWithPassword}>
          <Flex direction="column" gap="3">
            <Box>
              <Text as="label" size="2" weight="medium" color="gray" htmlFor="login-email">
                Email
              </Text>
              <TextField.Root
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                placeholder="you@company.com"
                size="3"
                mt="1"
              />
            </Box>

            {isEmailStep ? (
              <Button type="submit" size="3" disabled={!!loading || !email}>
                {loading === 'check-email' ? <Spinner size="2" /> : 'Continue'}
              </Button>
            ) : (
              <>
                <Box>
                  <Text as="label" size="2" weight="medium" color="gray" htmlFor="login-password">
                    Password
                  </Text>
                  <TextField.Root
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => onPasswordChange(e.target.value)}
                    placeholder="••••••••"
                    size="3"
                    mt="1"
                    autoFocus
                  />
                </Box>

                <Button type="submit" size="3" disabled={!!loading}>
                  {loading === 'password' ? <Spinner size="2" /> : 'Sign in with Password'}
                </Button>

                <Button type="button" variant="outline" size="3" disabled={!!loading} onClick={onSendMagicCode}>
                  {loading === 'magic-send' ? <Spinner size="2" /> : 'Send Magic Code Instead'}
                </Button>
              </>
            )}
          </Flex>
        </form>

        <Flex align="center" gap="3" my="4">
          <Separator size="4" />
          <Text size="2" color="gray">
            or
          </Text>
          <Separator size="4" />
        </Flex>

        <a href="/api/auth/google" className="google-btn">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.03 24.03 0 0 0 0 21.56l7.98-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
          Sign in with Google
        </a>
      </Card>
      <LogPanel logs={logs} />
    </div>
  );
}
