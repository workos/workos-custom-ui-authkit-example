import { Callout } from '@radix-ui/themes';

export function ErrorCallout({ message }: { message: string }) {
  return (
    <Callout.Root color="red" size="1" mb="4">
      <Callout.Text>{message}</Callout.Text>
    </Callout.Root>
  );
}
