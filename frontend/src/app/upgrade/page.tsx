"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  Bell,
  Crown,
  Gem,
  Infinity,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function UpgradePage() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const premiumFeatures = [
    {
      icon: <Crown className="w-6 h-6" />,
      title: "Premium Content Creation",
      description:
        "Unlimited media uploads with advanced AI-powered verification tools just",
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: "Lightning Fast Processing",
      description: "Priority processing with 10x faster verification speeds",
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: "Enhanced Security",
      description: "Advanced blockchain verification and tamper-proof storage",
    },
    {
      icon: <Infinity className="w-6 h-6" />,
      title: "Unlimited Storage",
      description:
        "Store unlimited content with enterprise-grade cloud infrastructure",
    },
    {
      icon: <Star className="w-6 h-6" />,
      title: "Priority Support",
      description: "24/7 dedicated support with guaranteed response times",
    },
    {
      icon: <Rocket className="w-6 h-6" />,
      title: "Early Access",
      description: "Be the first to try new features and beta releases",
    },
  ];

  const pricingTiers = [
    {
      name: "Pro",
      price: "$19",
      period: "/month",
      icon: <Gem className="w-8 h-8" />,
      features: [
        "Unlimited uploads",
        "Advanced AI verification",
        "Priority processing",
        "Enhanced security",
        "Email support",
      ],
      popular: false,
    },
    {
      name: "Enterprise",
      price: "$49",
      period: "/month",
      icon: <Crown className="w-8 h-8" />,
      features: [
        "Everything in Pro",
        "Unlimited storage",
        "24/7 phone support",
        "Custom integrations",
        "Advanced analytics",
        "White-label options",
      ],
      popular: true,
    },
  ];

  return (
    <main className="min-h-screen bg-[#181A1D] text-white">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-[#181A1D]">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-blue-900/20"></div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(147,51,234,0.1),transparent_50%)]"></div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 py-12">
        <div
          className={`max-w-6xl mx-auto text-center transition-all duration-1000 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          {/* Coming Soon Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-400 text-sm font-medium mb-8 animate-pulse">
            <Sparkles className="w-4 h-4" />
            Coming Soon
          </div>

          {/* Main Heading */}
          <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-white via-purple-100 to-blue-200 bg-clip-text text-transparent">
            Upgrade
          </h1>

          <p className="text-xl md:text-2xl text-gray-300 mb-12 max-w-3xl mx-auto leading-relaxed">
            Unlock the full potential of V.E.R.A. with premium features designed
            for creators, businesses, and power users.
            <span className="text-purple-400 font-semibold">
              {" "}
              Coming soon
            </span>{" "}
            with exclusive benefits and advanced capabilities.
          </p>

          {/* Premium Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16 max-w-6xl mx-auto">
            {premiumFeatures.map((feature, index) => (
              <Card
                key={index}
                className={`p-6 bg-[#2E3137]/50 border-gray-700/50 backdrop-blur-sm hover:bg-[#2E3137]/70 transition-all duration-300 hover:scale-105 hover:border-purple-500/30 ${
                  isVisible
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-8"
                }`}
                style={{ transitionDelay: `${index * 100}ms` }}
              >
                <div className="flex flex-col items-center text-center">
                  <div className="p-4 rounded-xl bg-purple-500/20 text-purple-400 mb-4">
                    {feature.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-3">
                    {feature.title}
                  </h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </Card>
            ))}
          </div>

          {/* Pricing Preview */}
          <div className="mb-16">
            <h2 className="text-3xl font-bold text-white mb-8">
              Pricing Preview
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              {pricingTiers.map((tier, index) => (
                <Card
                  key={index}
                  className={`p-8 relative ${
                    tier.popular
                      ? "bg-gradient-to-br from-purple-500/20 to-blue-500/20 border-purple-500/50"
                      : "bg-[#2E3137]/50 border-gray-700/50"
                  } backdrop-blur-sm transition-all duration-300 hover:scale-105`}
                >
                  {tier.popular && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                      <span className="bg-gradient-to-r from-purple-500 to-blue-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
                        Most Popular
                      </span>
                    </div>
                  )}

                  <div className="text-center">
                    <div className="flex justify-center mb-4">
                      <div
                        className={`p-3 rounded-xl ${
                          tier.popular
                            ? "bg-purple-500/20 text-purple-400"
                            : "bg-gray-600/20 text-gray-400"
                        }`}
                      >
                        {tier.icon}
                      </div>
                    </div>

                    <h3 className="text-2xl font-bold text-white mb-2">
                      {tier.name}
                    </h3>

                    <div className="mb-6">
                      <span className="text-4xl font-bold text-white">
                        {tier.price}
                      </span>
                      <span className="text-gray-400">{tier.period}</span>
                    </div>

                    <ul className="space-y-3 mb-8 text-left">
                      {tier.features.map((feature, featureIndex) => (
                        <li
                          key={featureIndex}
                          className="flex items-center gap-3 text-gray-300"
                        >
                          <div className="w-2 h-2 bg-purple-500 rounded-full flex-shrink-0"></div>
                          {feature}
                        </li>
                      ))}
                    </ul>

                    <Button
                      className={`w-full ${
                        tier.popular
                          ? "bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600"
                          : "bg-gray-600 hover:bg-gray-700"
                      } text-white font-semibold`}
                      disabled
                    >
                      Coming Soon
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
            <Button
              asChild
              className="px-8 py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-all duration-200 hover:scale-105 shadow-lg hover:shadow-purple-500/25"
            >
              <Link href="/">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Home
              </Link>
            </Button>

            <Button
              asChild
              className="px-8 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-semibold rounded-lg transition-all duration-200 hover:scale-105 shadow-lg hover:shadow-xl hover:shadow-emerald-500/25"
            >
              <Link href="/create-tag">
                <Sparkles className="w-4 h-4 mr-2" />
                Start Creating
              </Link>
            </Button>
          </div>

          {/* Notification Signup */}
          <Card className="p-6 bg-[#2E3137]/30 border-gray-700/50 backdrop-blur-sm max-w-md mx-auto">
            <div className="flex items-center gap-3 mb-4">
              <Bell className="w-5 h-5 text-purple-400" />
              <h3 className="text-lg font-semibold text-white">
                Get Early Access
              </h3>
            </div>
            <p className="text-gray-400 text-sm mb-4">
              Be the first to experience premium features and get exclusive
              early access pricing!
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="Enter your email"
                className="flex-1 px-3 py-2 bg-[#181A1D] border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:border-purple-500 transition-colors"
              />
              <Button className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md transition-colors">
                Notify Me
              </Button>
            </div>
          </Card>
        </div>

        {/* Floating Elements */}
        <div className="absolute top-20 left-10 w-2 h-2 bg-purple-400 rounded-full animate-ping opacity-75"></div>
        <div className="absolute top-40 right-20 w-1 h-1 bg-blue-400 rounded-full animate-pulse"></div>
        <div className="absolute bottom-40 left-20 w-1.5 h-1.5 bg-purple-300 rounded-full animate-ping opacity-60"></div>
        <div className="absolute bottom-20 right-10 w-2 h-2 bg-blue-300 rounded-full animate-pulse"></div>
      </div>
    </main>
  );
}
