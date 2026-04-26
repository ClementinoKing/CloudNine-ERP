import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useOrganization } from '@/features/organization/context/organization-context'

export function DashboardSectionPage({ title }: { title: string }) {
  const { currentOrganization } = useOrganization()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{currentOrganization.name} module coming next</CardDescription>
      </CardHeader>
      <CardContent>
        <p className='text-sm text-muted-foreground'>
          This section is scaffolded and ready for detailed workflows in the next phase.
        </p>
      </CardContent>
    </Card>
  )
}
