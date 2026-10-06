require('dotenv').config();
const mongoose = require('mongoose');
const { Plan } = require('../models');

async function seed() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/cashly');
  
  const plans = [
    {
      name: 'Starter',
      description: 'The perfect entry-level asset.',
      initialPayment: 50000,
      dailyAmount: 1000,
      durationDays: 60,
      status: 'active',
      displayOrder: 1
    },
    {
      name: 'Elite',
      description: 'A balanced portfolio addition.',
      initialPayment: 150000,
      dailyAmount: 3500,
      durationDays: 60,
      status: 'active',
      displayOrder: 2
    },
    {
      name: 'Premium',
      description: 'Maximum yield for serious investors.',
      initialPayment: 500000,
      dailyAmount: 15000,
      durationDays: 60,
      status: 'active',
      displayOrder: 3
    }
  ];

  for (let p of plans) {
    const exists = await Plan.findOne({ name: p.name });
    if (!exists) {
      await Plan.create({ ...p, totalScheduled: p.dailyAmount * p.durationDays });
      console.log('Created plan:', p.name);
    }
  }

  console.log('Seeding complete.');
  process.exit(0);
}

seed();
