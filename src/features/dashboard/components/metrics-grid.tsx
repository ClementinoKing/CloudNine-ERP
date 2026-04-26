import { Clock3, ListTodo, CheckCircle2, TriangleAlert } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const metrics = [
  { label: 'Tasks Due', value: '14', icon: Clock3, tone: 'text-amber-600' },
  { label: 'In Progress', value: '29', icon: ListTodo, tone: 'text-blue-600' },
  { label: 'Completed', value: '74', icon: CheckCircle2, tone: 'text-emerald-600' },
  { label: 'Overdue', value: '5', icon: TriangleAlert, tone: 'text-rose-600' },
] as const

export function MetricsGrid() {
  return (
    <section className='grid gap-4 md:grid-cols-2 xl:grid-cols-4' aria-label='Key metrics'>
      {metrics.map((metric) => (
        <Card key={metric.label}>
          <CardHeader className='pb-3'>
            <CardTitle className='text-sm font-medium text-muted-foreground'>{metric.label}</CardTitle>
          </CardHeader>
          <CardContent className='flex items-end justify-between'>
            <p className='text-3xl font-semibold tracking-tight'>{metric.value}</p>
            <metric.icon className={`h-5 w-5 ${metric.tone}`} aria-hidden='true' />
          </CardContent>
        </Card>
      ))}
    </section>
  )
}
