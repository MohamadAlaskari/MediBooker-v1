/** The named formats of the message binding (05 §2.4). Times use tabular figures in the UI. */
export const formats = {
  dateTime: {
    appointment: {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
    },
    day: { weekday: 'short', day: 'numeric', month: 'short' },
    time: { hour: 'numeric', minute: '2-digit' },
  },
  number: {},
  list: {},
} as const;
