// FILE: scripts/seedKnowledgeBase.js
// Imports your DigeeSell KB from the DOCX into Supabase with embeddings
// Usage: node scripts/seedKnowledgeBase.js

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Knowledge Base chunks extracted from DigeeSell_Knowledge_Base_Complete.docx
 * Each chunk is a self-contained topic that can be returned as-is to the LLM
 */
const KBChunks = [
  {
    title: 'Company Overview',
    content: `DigeeSell is a full-service digital marketing agency headquartered in Gurugram, India, with offices in Dubai, UAE. 
Founded 8+ years ago, we serve 200+ clients across industries including e-commerce, healthcare, real estate, and education.
Leadership: Divas Khurana (12+ years digital marketing) and Niveshh Babbar (AI automation expert).
Certifications: Google Partner, Meta Business Partner, HubSpot Certified.
We specialize in integrated digital strategies combining SEO, paid ads, content, and social media.`,
    category: 'company',
  },

  {
    title: 'SEO Services',
    content: `DigeeSell offers comprehensive SEO services for organic traffic growth.
Services include: keyword research, technical SEO, on-page optimization, content creation, link building, local SEO, and monthly reporting.
Who it's for: Any business wanting sustainable organic growth, from local providers to e-commerce brands.
Timeline: Initial rankings 3-6 months, significant growth 6-12 months depending on competition.
Best for high-intent keyword targeting and long-term traffic sustainability.`,
    category: 'services',
  },

  {
    title: 'Google Ads & PPC Marketing',
    content: `DigeeSell is a certified Google Ads partner offering search, display, shopping, and YouTube ads.
Services: keyword research, ad copy testing, bid management, landing page optimization, performance tracking.
Also offers Meta Ads (Facebook & Instagram) and retargeting campaigns.
Expected ROI: Most clients see positive ROAS within 30-60 days with proper setup.
Focus on continuously lowering cost per lead (CPL) and cost per acquisition (CPA) through optimization.`,
    category: 'services',
  },

  {
    title: 'Social Media Marketing',
    content: `Full-service social media management across Instagram, Facebook, LinkedIn, YouTube, Twitter/X, Pinterest, and WhatsApp Business.
Services: strategy development, creative content (posts, reels, stories, short-form video), paid ads, influencer partnerships, community management, analytics and A/B testing.
Timeline: Follower and engagement growth within 90 days. Paid lead generation within 30-60 days.
DigeeSell is a leading SMM agency in Delhi NCR with proven audience and engagement growth.`,
    category: 'services',
  },

  {
    title: 'Content Marketing & Copywriting',
    content: `Full-service content strategy, creation, and distribution.
Services: SEO-optimized blog posts, website copy, social media content, email newsletters, case studies, whitepapers, video scripts, press releases.
Content audit to identify gaps and refresh underperforming pages.
Process: Research audience → build content calendar → create high-quality content → distribute → measure and refine.
Powers every successful SEO, social, and email campaign for sustainable organic growth.`,
    category: 'services',
  },

  {
    title: 'Email & WhatsApp Marketing',
    content: `Targeted email and WhatsApp marketing for lead nurturing and customer retention.
Email services: responsive templates, audience segmentation, welcome sequences, drip campaigns, personalization, A/B testing, performance tracking.
WhatsApp Business API campaigns: promotions, transactional messages, customer support, lead nurturing.
Expected results: Email open rates 20-40%, WhatsApp open rates 90%+ in India.
Automated sequences reduce manual effort while driving consistent revenue.`,
    category: 'services',
  },

  {
    title: 'Web Design & Development',
    content: `Custom website design and development combining creativity with technical expertise.
Services: custom design, responsive web design, e-commerce development, UI/UX optimization, SEO integration from ground up, appointment booking, CRM integrations, speed optimization, Core Web Vitals compliance, ongoing support.
Technologies: custom coding, WordPress, Shopify, React, and modern frameworks chosen based on specific needs.
Who it's for: Businesses needing new sites, redesigns, or upgrades, especially healthcare, e-commerce, real estate, and service businesses.`,
    category: 'services',
  },

  {
    title: 'Online Reputation Management (ORM)',
    content: `Online Reputation Management protects and enhances your brand image across digital platforms.
Services: brand monitoring across platforms, review management (Google, Justdial, Practo, Amazon), positive content creation and promotion, SEO optimization for reputation, crisis response, competitor reputation analysis, social media reputation management.
Why it matters: Over 90% of consumers read reviews before purchase. A single unaddressed review can cost dozens of potential customers.
Especially important for healthcare, hotels, restaurants, real estate, education, and e-commerce.`,
    category: 'services',
  },

  {
    title: 'Branding & Brand Strategy',
    content: `DigeeSell helps build, launch, and reposition brands that stand out in competitive markets.
Services: brand assessment (1-5 scale scoring), brand planning, brand creation (logo, visual identity, guidelines), brand rebranding and refresh, goal identification, strategy definition.
Process: Discover → Assess → Strategy → Create → Launch → Monitor.
Who it's for: New businesses launching first brand identity, and established businesses modernizing, repositioning, or expanding into new markets.
We are professionally innovative and digitally creative.`,
    category: 'services',
  },

  {
    title: 'E-Commerce Marketing Solutions',
    content: `DigeeSell specializes in driving traffic, conversions, and sales for online stores.
Services: e-commerce SEO, product listing optimization, social media advertising (Instagram, Facebook, YouTube), Google Shopping and Performance Max, email marketing automation, PPC advertising, content marketing, conversion rate optimization.
Who it's for: D2C brands, fashion, electronics, health and wellness, any product-based business in India or internationally.
Expected results: Paid results within 30 days. Organic growth from SEO within 3-6 months. Combined strategies deliver 2-4x improvement in ROAS within 12 months.`,
    category: 'services',
  },

  {
    title: 'DigeeMed - Healthcare Marketing Division',
    content: `DigeeMed is DigeeSell's dedicated healthcare digital marketing unit for doctors, clinics, hospitals, and healthcare brands.
Services: SEO for healthcare (doctor near me, specialty keywords), social media marketing, PPC for appointment bookings, healthcare web development with booking systems, medical content marketing, email marketing, review management, analytics.
Proven results: 10x ROAS for healthcare clients, 1M+ YouTube views, 4.5+ average Google rating, 1M+ organic traffic sessions, 200M+ social reach.
Solves: patient retention, online visibility, appointment generation, reputation management, outdated websites.
Contact: +91-9999201459 or info@digeemed.com`,
    category: 'services',
  },

  {
    title: 'Pricing',
    content: `DigeeSell offers flexible, customized pricing based on business size and goals.
SEO: Starting INR 15,000/month for local campaigns, INR 30,000-80,000/month for mid-market, enterprise priced individually.
Social Media Marketing: Basic INR 12,000/month (2-3 platforms), full-service INR 25,000-60,000/month with paid ads.
PPC Management: INR 10,000/month or 10-15% of ad spend (whichever is higher). Ad budget paid separately to Google/Meta.
Content Marketing: INR 10,000/month for 4 blog posts. Full retainers customized by volume.
Web Design: Depends on type and scope. Contact for custom quote.
ORM: Customized based on platforms and complexity.
Contact: +91-7217701713 or info@digeesell.com for free brand audit and custom quote.`,
    category: 'pricing',
  },

  {
    title: 'Contact & Onboarding',
    content: `Get started with a free brand consultation.
India Office: 6th Floor MM Towers (Cube8), Phase IV, Udyog Vihar, Sector 18, Gurugram, Haryana 122022
India Phone: +91-7217701713 or +91-9999201459
Email: info@digeesell.com
UAE Office: Royal Class Business Center, Arjumand Building, Dubai
UAE Phone: +971 556805863
Email: info@digeesell.ae
Website: digeesell.com
Response time: Within 24 hours. Free brand audit with every inquiry.
Onboarding typically takes 2-3 days after agreement.`,
    category: 'contact',
  },
];

/**
 * Generate embedding for text using OpenAI API
 */
async function generateEmbedding(text) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Seed a single KB chunk into Supabase
 */
async function seedChunk(chunk, index) {
  console.log(`[${index + 1}/${KBChunks.length}] Seeding: ${chunk.title}...`);
  
  try {
    // Generate embedding for the content
    const embedding = await generateEmbedding(chunk.content);
    
    // Insert into Supabase
    const { data, error } = await supabase
      .from('documents')
      .insert({
        content: chunk.content,
        metadata: {
          title: chunk.title,
          category: chunk.category,
        },
        embedding: embedding,
      });
    
    if (error) {
      console.error(`✗ Error seeding "${chunk.title}":`, error);
      return false;
    }
    
    console.log(`✓ Seeded: ${chunk.title}`);
    return true;
  } catch (err) {
    console.error(`✗ Exception seeding "${chunk.title}":`, err.message);
    return false;
  }
}

/**
 * Main seeding function
 */
async function seedAllChunks() {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  DigeeSell Knowledge Base Seeding');
  console.log('═══════════════════════════════════════════');
  console.log('');
  
  // Verify Supabase connection
  try {
    const { data, error } = await supabase.from('documents').select('count', { count: 'exact' });
    if (error) {
      console.error('✗ Error connecting to Supabase:', error);
      process.exit(1);
    }
    console.log(`Current KB size: ${data ? data.length : 0} chunks\n`);
  } catch (err) {
    console.error('✗ Supabase connection failed:', err.message);
    process.exit(1);
  }
  
  // Seed all chunks
  let successful = 0;
  let failed = 0;
  
  for (let i = 0; i < KBChunks.length; i++) {
    const success = await seedChunk(KBChunks[i], i);
    if (success) {
      successful++;
    } else {
      failed++;
    }
    
    // Small delay between API calls to avoid rate limiting
    if (i < KBChunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  Seeding Complete');
  console.log('═══════════════════════════════════════════');
  console.log(`✓ Successful: ${successful}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Total: ${successful + failed}/${KBChunks.length}`);
  console.log('');
  
  if (failed === 0) {
    console.log('✓ All chunks seeded successfully!');
    console.log('Your KB is now ready for semantic search.');
  } else {
    console.log('⚠ Some chunks failed to seed. Check errors above.');
  }
  
  process.exit(failed === 0 ? 0 : 1);
}

// Run seeding
seedAllChunks().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
