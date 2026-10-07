import { EmptyState, PageHeader } from '../components/ui'

export default function Reports() {
  return (
    <div>
      <PageHeader
        title="Reports"
      />
      <EmptyState title="No data to report" hint="Revenue, profit and sales reports will appear once you have activity." />
    </div>
  )
}
