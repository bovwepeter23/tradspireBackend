const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const Order = require('../models/Order');
const analyticsController = require('../controllers/analyticsController');

let originalAggregate;

afterEach(() => {
  if (originalAggregate) Order.aggregate = originalAggregate;
  originalAggregate = undefined;
});

const invokeAnalytics = async (query, aggregateResult) => {
  originalAggregate = Order.aggregate;
  let pipeline;
  Order.aggregate = async (value) => {
    pipeline = value;
    return aggregateResult;
  };

  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };

  await analyticsController.getAdminAnalytics({ query }, response);
  return { pipeline, response };
};

const zeroResult = [{
  summary: [],
  timeline: [],
  orderMix: [],
  statusCounts: [],
  topProducts: [],
  recentOrders: []
}];

test('returns zeroed metrics and empty lists when no orders match', async () => {
  const { pipeline, response } = await invokeAnalytics({
    from: '2026-01-01',
    to: '2026-02-01',
    groupBy: 'month'
  }, zeroResult);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.summary, {
    orderCount: 0,
    bookedValue: 0,
    averageOrderValue: 0,
    rentalUnits: 0
  });
  assert.deepEqual(response.body.orderMix, { buyValue: 0, rentValue: 0, buyUnits: 0, rentUnits: 0 });
  assert.deepEqual(response.body.timeline, []);
  assert.deepEqual(response.body.topProducts, []);
  assert.deepEqual(response.body.recentOrders, []);
  assert.deepEqual(response.body.statusCounts, {
    pending: 0,
    confirmed: 0,
    processing: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0
  });
  assert.deepEqual(pipeline[0].$match.createdAt, {
    $gte: new Date('2026-01-01T00:00:00.000Z'),
    $lt: new Date('2026-02-01T00:00:00.000Z')
  });
  assert.equal(pipeline[1].$facet.timeline[0].$group._id.$dateTrunc.unit, 'month');
});

test('cancelled orders count toward statuses but not booked metrics', async () => {
  const result = [{
    summary: [{ orderCount: 2, bookedValue: 50, averageOrderValue: 50, rentalUnits: 0 }],
    timeline: [{ date: new Date('2026-01-01T00:00:00.000Z'), orderCount: 2, bookedValue: 50 }],
    orderMix: [{ buyValue: 50, rentValue: 0, buyUnits: 1, rentUnits: 0 }],
    statusCounts: [{ _id: 'pending', count: 1 }, { _id: 'cancelled', count: 1 }],
    topProducts: [{ productName: 'Lamp', units: 1, bookedValue: 50 }],
    recentOrders: [{ orderReference: '65a000000000000000000001', date: new Date('2026-01-01T00:00:00.000Z'), status: 'cancelled', total: 50 }]
  }];
  const { pipeline, response } = await invokeAnalytics({ from: '2026-01-01', to: '2026-02-01' }, result);
  const facets = pipeline[1].$facet;
  const serializedSummary = JSON.stringify(facets.summary);

  assert.equal(response.body.summary.orderCount, 2);
  assert.equal(response.body.summary.bookedValue, 50);
  assert.equal(response.body.statusCounts.cancelled, 1);
  assert.match(serializedSummary, /\$status.*cancelled/);
  assert.deepEqual(facets.statusCounts, [{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  assert.deepEqual(facets.orderMix[0], { $match: { status: { $ne: 'cancelled' } } });
  assert.deepEqual(facets.topProducts[0], { $match: { status: { $ne: 'cancelled' } } });
});

test('aggregates buy and rent values and units from item snapshots', async () => {
  const result = [{
    summary: [{ orderCount: 1, bookedValue: 140, averageOrderValue: 140, rentalUnits: 2 }],
    timeline: [{ date: new Date('2026-03-02T00:00:00.000Z'), orderCount: 1, bookedValue: 140 }],
    orderMix: [{ buyValue: 100, rentValue: 40, buyUnits: 1, rentUnits: 2 }],
    statusCounts: [{ _id: 'confirmed', count: 1 }],
    topProducts: [{ productName: 'Desk', units: 1, bookedValue: 100 }, { productName: 'Chair', units: 2, bookedValue: 40 }],
    recentOrders: [{ orderReference: '65a000000000000000000002', date: new Date('2026-03-02T09:00:00.000Z'), status: 'confirmed', total: 140 }]
  }];
  const { pipeline, response } = await invokeAnalytics({
    from: '2026-03-01T00:00:00Z',
    to: '2026-04-01T00:00:00+00:00',
    groupBy: 'week'
  }, result);
  const facets = pipeline[1].$facet;
  const orderMixGroup = facets.orderMix.find((stage) => stage.$group)?.$group;

  assert.deepEqual(response.body.orderMix, { buyValue: 100, rentValue: 40, buyUnits: 1, rentUnits: 2 });
  assert.equal(response.body.summary.rentalUnits, 2);
  assert.equal(orderMixGroup.buyValue.$sum.$cond[0].$eq[1], 'buy');
  assert.equal(orderMixGroup.rentValue.$sum.$cond[0].$eq[1], 'rent');
  assert.deepEqual(orderMixGroup.buyUnits.$sum.$cond[1], { $ifNull: ['$items.quantity', 0] });
  assert.equal(facets.timeline[0].$group._id.$dateTrunc.startOfWeek, 'monday');
  assert.deepEqual(Object.keys(facets.recentOrders.at(-1).$project).sort(), ['_id', 'date', 'orderReference', 'status', 'total'].sort());
});

test('rejects invalid ranges and unsupported grouping without querying orders', async () => {
  const original = Order.aggregate;
  Order.aggregate = () => {
    throw new Error('Aggregation should not run for invalid query parameters');
  };
  originalAggregate = original;
  const response = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };

  await analyticsController.getAdminAnalytics({ query: {
    from: '2026-02-30',
    to: '2026-01-01',
    groupBy: 'year'
  } }, response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /valid ISO-8601/);
});