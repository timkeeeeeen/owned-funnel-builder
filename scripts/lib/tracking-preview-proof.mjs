export function assertTrackingPreviewRows(results, expected) {
  const rows = results.flatMap((result) => result.results ?? []);
  const events = rows.filter((row) => typeof row.event_name === 'string');
  for (const item of expected)
    if (!events.some((row) => row.event_id === item.event_id && row.event_name === item.event_name))
      throw new Error(`missing ${item.event_name} proof`);
  if (events.some((row) => row.event_name === 'Purchase')) throw new Error('Purchase persisted');
  const delivery = rows.find((row) => 'delivered_count' in row);
  if (Number(delivery?.delivered_count) !== 0) throw new Error('destination delivery was not zero');
}
