'use strict';

// Venue stream setups confirmed by observation. DigitalPool venue IDs are
// stable across tournaments. A channel mapping is required when the stream
// title and description do not identify the venue or table.
var KNOWN_VENUE_STREAMS = {
  // The Black Diamond, Spokane Valley, Washington
  '862': { channelId: 'UCOKrmdnCIee9WYvQJFsmRpA', tableNum: '9' },
};
