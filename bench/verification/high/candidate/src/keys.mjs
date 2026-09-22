export function eventKey(partition, id) {
  return id;
}

export function checkpointKey(partition) {
  return partition;
}
