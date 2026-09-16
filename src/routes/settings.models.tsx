import { createFileRoute } from '@tanstack/react-router'
import { ModelSettings } from '#/models/ui/model-settings'

export const Route = createFileRoute('/settings/models')({
  component: ModelSettings,
})
