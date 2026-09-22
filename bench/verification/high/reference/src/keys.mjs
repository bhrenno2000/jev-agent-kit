export function eventKey(partition, id) {
  return JSON.stringify([partition, id]);
}

export function checkpointKey(partition) {
  return partition;
}
