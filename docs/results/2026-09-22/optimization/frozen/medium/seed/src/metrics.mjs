export const count = (events, type) => events.filter((event) => event.type === type).length;
