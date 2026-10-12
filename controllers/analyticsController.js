const Order = require('../models/Order');

const orderStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2}))?$/i;

const parseIsoDate = (value) => {
  if (typeof value !== 'string') return null;
  const match = value.match(isoDatePattern);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , timezone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText || 0);
  const minute = Number(minuteText || 0);
  const second = Number(secondText || 0);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  if (timezone && timezone.toUpperCase() !== 'Z') {
    const offsetHours = Number(timezone.slice(1, 3));
    const offsetMinutes = Number(timezone.slice(4, 6));
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
};

const nonCancelled = { $ne: ['$status', 'cancelled'] };
const itemQuantity = { $ifNull: ['$items.quantity', 0] };
const itemLineTotal = { $ifNull: ['$items.lineTotal', 0] };

const buildAnalyticsPipeline = (from, to, groupBy) => {
  const dateTrunc = { date: '$createdAt', unit: groupBy, timezone: 'UTC' };
  if (groupBy === 'week') dateTrunc.startOfWeek = 'monday';

  return [
    { $match: { createdAt: { $gte: from, $lt: to } } },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              orderCount: { $sum: 1 },
              bookedValue: {
                $sum: { $cond: [nonCancelled, { $ifNull: ['$total', 0] }, 0] }
              },
              eligibleOrderCount: { $sum: { $cond: [nonCancelled, 1, 0] } },
              rentalUnits: {
                $sum: {
                  $cond: [
                    nonCancelled,
                    {
                      $reduce: {
                        input: { $ifNull: ['$items', []] },
                        initialValue: 0,
                        in: {
                          $add: [
                            '$$value',
                            {
                              $cond: [
                                { $eq: ['$$this.purchaseType', 'rent'] },
                                { $ifNull: ['$$this.quantity', 0] },
                                0
                              ]
                            }
                          ]
                        }
                      }
                    },
                    0
                  ]
                }
              }
            }
          },
          {
            $project: {
              _id: 0,
              orderCount: 1,
              bookedValue: { $round: ['$bookedValue', 2] },
              averageOrderValue: {
                $round: [
                  {
                    $cond: [
                      { $gt: ['$eligibleOrderCount', 0] },
                      { $divide: ['$bookedValue', '$eligibleOrderCount'] },
                      0
                    ]
                  },
                  2
                ]
              },
              rentalUnits: 1
            }
          }
        ],
        timeline: [
          {
            $group: {
              _id: { $dateTrunc: dateTrunc },
              orderCount: { $sum: 1 },
              bookedValue: { $sum: { $cond: [nonCancelled, { $ifNull: ['$total', 0] }, 0] } }
            }
          },
          {
            $project: {
              _id: 0,
              date: '$_id',
              orderCount: 1,
              bookedValue: { $round: ['$bookedValue', 2] }
            }
          },
          { $sort: { date: 1 } }
        ],
        orderMix: [
          { $match: { status: { $ne: 'cancelled' } } },
          { $unwind: '$items' },
          {
            $group: {
              _id: null,
              buyValue: { $sum: { $cond: [{ $eq: ['$items.purchaseType', 'buy'] }, itemLineTotal, 0] } },
              rentValue: { $sum: { $cond: [{ $eq: ['$items.purchaseType', 'rent'] }, itemLineTotal, 0] } },
              buyUnits: { $sum: { $cond: [{ $eq: ['$items.purchaseType', 'buy'] }, itemQuantity, 0] } },
              rentUnits: { $sum: { $cond: [{ $eq: ['$items.purchaseType', 'rent'] }, itemQuantity, 0] } }
            }
          },
          {
            $project: {
              _id: 0,
              buyValue: { $round: ['$buyValue', 2] },
              rentValue: { $round: ['$rentValue', 2] },
              buyUnits: 1,
              rentUnits: 1
            }
          }
        ],
        statusCounts: [
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ],
        topProducts: [
          { $match: { status: { $ne: 'cancelled' } } },
          { $unwind: '$items' },
          {
            $group: {
              _id: { $ifNull: ['$items.name', 'Unknown product'] },
              units: { $sum: itemQuantity },
              bookedValue: { $sum: itemLineTotal }
            }
          },
          { $sort: { bookedValue: -1, units: -1, _id: 1 } },
          { $limit: 10 },
          {
            $project: {
              _id: 0,
              productName: '$_id',
              units: 1,
              bookedValue: { $round: ['$bookedValue', 2] }
            }
          }
        ],
        recentOrders: [
          { $sort: { createdAt: -1, _id: -1 } },
          { $limit: 10 },
          {
            $project: {
              _id: 0,
              orderReference: { $toString: '$_id' },
              date: '$createdAt',
              status: 1,
              total: { $round: [{ $ifNull: ['$total', 0] }, 2] }
            }
          }
        ]
      }
    }
  ];
};

exports.getAdminAnalytics = async (req, res) => {
  const { from: fromValue, to: toValue, groupBy: requestedGroupBy } = req.query;
  const from = parseIsoDate(fromValue);
  const to = parseIsoDate(toValue);
  const groupBy = requestedGroupBy === undefined ? 'day' : requestedGroupBy;

  if (!from || !to || from >= to || !['day', 'week', 'month'].includes(groupBy)) {
    return res.status(400).json({
      message: 'Provide valid ISO-8601 from and to dates with from before to, and groupBy day, week, or month'
    });
  }

  const [facets = {}] = await Order.aggregate(buildAnalyticsPipeline(from, to, groupBy));
  const summary = facets.summary?.[0] || {};
  const orderMix = facets.orderMix?.[0] || {};
  const statusCounts = Object.fromEntries(orderStatuses.map((status) => [status, 0]));

  for (const entry of facets.statusCounts || []) {
    if (entry._id) statusCounts[entry._id] = entry.count;
  }

  return res.json({
    success: true,
    summary: {
      orderCount: summary.orderCount || 0,
      bookedValue: summary.bookedValue || 0,
      averageOrderValue: summary.averageOrderValue || 0,
      rentalUnits: summary.rentalUnits || 0
    },
    timeline: facets.timeline || [],
    orderMix: {
      buyValue: orderMix.buyValue || 0,
      rentValue: orderMix.rentValue || 0,
      buyUnits: orderMix.buyUnits || 0,
      rentUnits: orderMix.rentUnits || 0
    },
    statusCounts,
    topProducts: facets.topProducts || [],
    recentOrders: facets.recentOrders || []
  });
};

exports.buildAnalyticsPipeline = buildAnalyticsPipeline;