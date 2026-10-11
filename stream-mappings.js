'use strict';

// Venue stream setups confirmed by observation. DigitalPool venue IDs are
// stable across tournaments. A channel mapping is required when the stream
// title and description do not identify the venue or table.
var KNOWN_VENUE_STREAMS = {
  // The Black Diamond, Spokane Valley, Washington
  '862': { channelId: 'UCOKrmdnCIee9WYvQJFsmRpA', tableNum: '9' },
};

// Event-specific broadcasts without table/venue metadata in their titles.
var KNOWN_EVENT_STREAMS = {
  'bracketbeast:53': [
    { channelId: 'UC42Kp7cvohBsB3Yg4gFVj5w', tableNum: '9' },
  ],
};
