import { Avatar, Badge, Box, Button, Card, Code, Flex, Heading, Text } from '@radix-ui/themes';
import type { LogEntry, User } from '../types';
import { LogPanel } from '../components/LogPanel';

interface Props {
  user: User;
  orgId: string | null;
  logs: LogEntry[];
  onLogout: () => void;
}

export function DashboardView({ user, orgId, logs, onLogout }: Props) {
  return (
    <div className="page">
      <Card size="3" className="auth-card">
        <Heading size="5" align="center" mb="5">
          Dashboard
        </Heading>

        <Flex align="center" gap="4" mb="5">
          <Avatar
            size="4"
            src={user.profilePictureUrl ?? undefined}
            fallback={(user.firstName?.[0] || user.email[0]).toUpperCase()}
            radius="full"
          />
          <Box>
            <Text size="3" weight="bold">
              {[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}
            </Text>
            <Text size="2" color="gray" asChild>
              <div>{user.email}</div>
            </Text>
          </Box>
        </Flex>

        {orgId && (
          <Box mb="4">
            <Badge color="iris" size="2">
              Org: {orgId}
            </Badge>
          </Box>
        )}

        <Card size="2" mb="4">
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">
              User ID
            </Text>
            <Code size="2" variant="ghost">
              {user.id}
            </Code>
          </Flex>
        </Card>

        <Button color="red" size="3" className="full-width" onClick={onLogout}>
          Sign Out
        </Button>
      </Card>
      <LogPanel logs={logs} />
    </div>
  );
}
