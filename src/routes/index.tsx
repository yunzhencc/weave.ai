import { Link, createFileRoute } from '@tanstack/react-router';
import { ThemeToggle } from '#/components/motion/theme-toggle';
import { Button } from '#/components/ui/button';

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <main>
      Hello World

      <Button nativeButton={false} render={<Link to="/image" search={{ generation: undefined }} />}>图片生成</Button>

      <Button nativeButton={false} render={<Link to="/settings/models" />}>模型设置</Button>

      <ThemeToggle
        variant="circle-blur"
        start="bottom-up"
        className="rounded-xl border border-border bg-background p-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        iconClassName="h-5 w-5"
      />
    </main>
  )
}
