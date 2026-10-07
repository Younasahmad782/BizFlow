import { EmptyState, PageHeader, PrimaryButton } from '../components/ui'

export default function Sales() {
  return (
    <div>
      <PageHeader
        title="Sales"
        action={<PrimaryButton>Add</PrimaryButton>}
      />
      <EmptyState title="No sales recorded" hint="Record a sale when a customer buys — stock updates automatically." />
    </div>
  )
}
