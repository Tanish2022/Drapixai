'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function Pricing() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  const plans = [
    {
      name: 'Basic',
      monthlyPrice: 89,
      yearlyPrice: 76, // 15% off: 89 * 0.85 = 75.65 ≈ 76
      renders: '1,200',
      features: [
        '1,200 renders/month',
        '1 domain',
        'Watermark',
        '12-day free trial',
        'Email support',
        'Standard quality'
      ]
    },
    {
      name: 'Pro',
      monthlyPrice: 159,
      yearlyPrice: 135, // 15% off: 159 * 0.85 = 135.15 ≈ 135
      renders: '3,000',
      features: [
        '3,000 renders/month',
        '1 domain',
        'No watermark',
        'Priority support',
        'Enhanced quality',
        'Advanced analytics'
      ],
      popular: true,
      comingSoon: true
    },
    {
      name: 'Enterprise',
      monthlyPrice: 'Custom',
      yearlyPrice: 'Custom',
      renders: 'Unlimited',
      features: [
        'Unlimited renders',
        'Unlimited domains',
        'No watermark',
        'Dedicated GPU',
        'SLA guarantee',
        '24/7 support'
      ],
      comingSoon: true
    }
  ];

  return (
    <div className="min-h-screen bg-black text-white py-20">
      <div className="max-w-7xl mx-auto px-6">
        <h1 className="text-4xl font-bold text-center mb-4">Simple Pricing</h1>
        <p className="text-gray-400 text-center mb-12">Start free, upgrade when ready</p>

        {/* Billing Toggle */}
        <div className="flex justify-center mb-12">
          <div className="inline-flex items-center bg-white/5 rounded-full p-1 border border-white/10">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                billingCycle === 'monthly'
                  ? 'bg-purple-500 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                billingCycle === 'yearly'
                  ? 'bg-purple-500 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Yearly
              <span className="ml-2 text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                Save 15%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map((plan) => {
            const price = billingCycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;
            
            return (
              <div 
                key={plan.name} 
                className={`p-8 border rounded-2xl relative ${
                  plan.popular && !plan.comingSoon 
                    ? 'border-purple-500 bg-purple-500/10' 
                    : 'border-white/10'
                } ${plan.comingSoon ? 'opacity-60' : ''}`}
              >
                {plan.popular && !plan.comingSoon && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-purple-500 text-white px-3 py-1 rounded-full text-sm font-medium">
                    Most Popular
                  </div>
                )}
                
                {plan.comingSoon && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-gray-500 text-white px-3 py-1 rounded-full text-sm font-medium">
                    Coming Soon
                  </div>
                )}
                
                <h2 className="text-2xl font-bold mb-2">{plan.name}</h2>
                <div className="text-4xl font-bold mb-2">
                  {typeof price === 'number' ? (
                    <span>${price}<span className="text-lg text-gray-400">/mo</span></span>
                  ) : (
                    <span>{price}</span>
                  )}
                </div>
                {billingCycle === 'yearly' && typeof price === 'number' && (
                  <p className="text-sm text-gray-400 mb-2">
                    Billed ${price * 12}/year
                  </p>
                )}
                <p className="text-purple-400 mb-6">{plan.renders} renders/month</p>
                
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature) => (
                    <li key={feature} className="text-gray-400 flex items-center gap-2">
                      <span className="text-purple-400">✓</span> {feature}
                    </li>
                  ))}
                </ul>
                
                {plan.comingSoon ? (
                  <button 
                    disabled 
                    className="w-full py-3 bg-gray-800 rounded-lg cursor-not-allowed text-gray-400"
                  >
                    Coming Soon
                  </button>
                ) : (
                  <Link 
                    href="/auth/register" 
                    className={`block w-full py-3 rounded-lg text-center font-semibold hover:opacity-90 ${
                      plan.popular 
                        ? 'bg-gradient-to-r from-purple-500 to-pink-500' 
                        : 'bg-white/10 hover:bg-white/20'
                    }`}
                  >
                    Get Started
                  </Link>
                )}
              </div>
            );
          })}
        </div>

        {/* FAQ Section */}
        <div className="mt-20 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-8">Frequently Asked Questions</h2>
          
          <div className="space-y-4">
            <div className="p-6 border border-white/10 rounded-xl">
              <h3 className="font-semibold mb-2">What happens after my 12-day trial?</h3>
              <p className="text-gray-400">You'll need to upgrade to Basic ($89/mo) or Pro ($159/mo) to continue using DrapixAI.</p>
            </div>
            
            <div className="p-6 border border-white/10 rounded-xl">
              <h3 className="font-semibold mb-2">Can I change plans later?</h3>
              <p className="text-gray-400">Yes, you can upgrade or downgrade at any time. Changes take effect on your next billing cycle.</p>
            </div>
            
            <div className="p-6 border border-white/10 rounded-xl">
              <h3 className="font-semibold mb-2">What payment methods do you accept?</h3>
              <p className="text-gray-400">We accept all major credit cards, PayPal, and bank transfers for Enterprise plans.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}