import { Box, Button, Card, Flex, Heading, Text } from "@radix-ui/themes";
import type { LogEntry, OrgChoice } from "../types";
import { ErrorCallout } from "../components/ErrorCallout";
import { LogPanel } from "../components/LogPanel";

interface Props {
  orgChoices: OrgChoice[];
  loading: string | false;
  error: string;
  logs: LogEntry[];
  onSelectOrg: (id: string) => void;
  onBack: () => void;
}

export function OrgPickerView({ orgChoices, loading, error, logs, onSelectOrg, onBack }: Props) {
  return (
    <div className="page">
      <Card size="3" className="auth-card">
        <Heading size="5" align="center" mb="2">Select Organization</Heading>
        <Text size="2" color="gray" align="center" mb="4" asChild>
          <p>Your account belongs to multiple organizations. Choose one to continue.</p>
        </Text>
        {error && <ErrorCallout message={error} />}

        <Flex direction="column" gap="2">
          {orgChoices.map((oc) => (
            <Card
              key={oc.id}
              size="2"
              className="org-card"
              role="button"
              tabIndex={0}
              aria-label={`Select ${oc.name}`}
              onClick={() => !loading && onSelectOrg(oc.id)}
              onKeyDown={(e) => e.key === "Enter" && !loading && onSelectOrg(oc.id)}
              style={{ opacity: loading ? 0.6 : 1 }}
              asChild
            >
              <div>
                <Flex justify="between" align="center">
                  <Box>
                    <Text size="2" weight="bold">{oc.name}</Text>
                    <Text size="1" color="gray" asChild>
                      <div>{oc.id}</div>
                    </Text>
                  </Box>
                  <Text size="4" color="iris" aria-hidden="true">→</Text>
                </Flex>
              </div>
            </Card>
          ))}
        </Flex>

        <Button
          variant="outline"
          size="3"
          mt="4"
          className="full-width"
          onClick={onBack}
        >
          Back to Login
        </Button>
      </Card>
      <LogPanel logs={logs} />
    </div>
  );
}
