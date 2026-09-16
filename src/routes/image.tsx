import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/image')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>图片工作台</div>
}
