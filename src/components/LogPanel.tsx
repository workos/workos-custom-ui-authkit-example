import { Box, Card, Flex, Text } from "@radix-ui/themes";
import type { LogEntry } from "../types";

export function LogPanel({ logs }: { logs: LogEntry[] }) {
  if (logs.length === 0) return null;
  return (
    <Box className="log-panel">
      <Text size="1" weight="medium" color="gray" mb="2" asChild>
        <div>API Log</div>
      </Text>
      <Flex direction="column" gap="1">
        {logs.map((l, i) => (
          <Card key={i} size="1" className="log-entry">
            <Text size="1" color="iris">{l.ts} {l.method}</Text>{" "}
            <Text size="1" color="gray">{l.url}</Text>{" "}
            <Text size="1" color={l.status >= 400 ? "red" : "green"}>
              {l.status}
            </Text>
            <Text size="1" color="gray" asChild>
              <div style={{ marginTop: 2 }}>
                {JSON.stringify(l.body).slice(0, 200)}
              </div>
            </Text>
          </Card>
        ))}
      </Flex>
    </Box>
  );
}
