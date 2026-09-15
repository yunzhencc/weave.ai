import { createFileRoute } from '@tanstack/react-router'
import { Button } from '#/components/ui/button';

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <main>
      Hello World

      <Button>测试</Button>
    </main>
  )
}
