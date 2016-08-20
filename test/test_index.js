'use strict';

const expect = require('expect.js'),
  explore = require('../index.js');

describe('#formatAnswer', () => {
  const venue = {
    name: 'Benedict',
    location: {
      address: 'Corner of Allenby/Rotshild'
    }
  };

  it('returns a string', () => {
    expect(explore.formatAnswer(venue, 3)).to.be.eql('/venue4 Benedict, Corner of Allenby/Rotshild')
  });
});
