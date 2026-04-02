import { type FormEvent } from 'react';
import { Box, Button, Card, Flex, Heading, Spinner, Text, TextField } from '@radix-ui/themes';
import type { LogEntry } from '../types';
import { ErrorCallout } from '../components/ErrorCallout';
import { LogPanel } from '../components/LogPanel';

interface Props {
  email: string;
  magicCode: string;
  loading: string | false;
  error: string;
  logs: LogEntry[];
  onMagicCodeChange: (value: string) => void;
  onVerify: (e: FormEvent) => void;
  onBack: () => void;
}

export function MagicCodeView({ email, magicCode, loading, error, logs, onMagicCodeChange, onVerify, onBack }: Props) {
  return (
    <div className="page">
      <Card size="3" className="auth-card">
        <Heading size="5" align="center" mb="2">
          Enter Code
        </Heading>
        <Text size="2" color="gray" align="center" mb="4" asChild>
          <p>
            We sent a 6-digit code to{' '}
            <Text weight="bold" color="gray" highContrast>
              {email}
            </Text>
          </p>
        </Text>
        {error && <ErrorCallout message={error} />}

        <form onSubmit={onVerify}>
          <Flex direction="column" gap="3">
            <Box>
              <Text as="label" size="2" weight="medium" color="gray" htmlFor="magic-code">
                Code
              </Text>
              <TextField.Root
                id="magic-code"
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={magicCode}
                onChange={(e) => onMagicCodeChange(e.target.value)}
                placeholder="000000"
                maxLength={6}
                size="3"
                mt="1"
              />
            </Box>

            <Button type="submit" size="3" disabled={!!loading}>
              {loading === 'magic-verify' ? <Spinner size="2" /> : 'Verify Code'}
            </Button>
          </Flex>
        </form>

        <Button variant="outline" size="3" mt="3" className="full-width" onClick={onBack}>
          Back to Login
        </Button>
      </Card>
      <LogPanel logs={logs} />
    </div>
  );
}
