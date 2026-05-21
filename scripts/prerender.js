// scripts/prerender.js
// Generates static HTML pages for all 60 SEO landing pages.
// Run after vite build: node scripts/prerender.js
// Each page gets its own HTML file with correct meta tags baked in.
// Google reads the static HTML — no JS execution needed for indexing.

const fs   = require('fs');
const path = require('path');

const BASE    = 'https://www.kloudaudit.eu';
const DIST    = path.join(__dirname, '..', 'dist');
const INDEX   = path.join(DIST, 'index.html');

if (!fs.existsSync(INDEX)) {
  console.error('dist/index.html not found — run vite build first');
  process.exit(1);
}

const indexHtml = fs.readFileSync(INDEX, 'utf8');

// ── ALL 60 SEO PAGES ─────────────────────────────────────────────────────────
const SEO_PAGES = [
// AWS Cost (15)
  
]/ scripts/prerender.js
// Generates static HTML pages for all 60 SEO landing pages.
// Run after vite build: node scripts/prerender.js
// Each page gets its own HTML file with correct meta tags baked in.
// Google reads the static HTML — no JS execution needed for indexing.

const path = require('path');

const BASE    = 'https://www.kloudaudit.eu';
const DIST    = path.join(__dirname, '..', 'dist');
const INDEX   = path.join(DIST, 'index.html');

if (!fs.existsSync(INDEX)) {
  console.error('dist/index.html not found — run vite build first');
  process.exit(1);
}

const indexHtml = fs.readFileSync(INDEX, 'utf8');

// ── ALL 60 SEO PAGES ─────────────────────────────────────────────────────────
const SEO_PAGES = [
  // AWS Cost (25)
  { slug: "fix-aws-nat-gateway-charges",      provider: "AWS",         title: "How to Fix Excessive AWS NAT Gateway Charges",                      saving: "10–30%",  keyword: "Excessive NAT Gateway charges AWS" },
  { slug: "reduce-aws-ec2-cost",              provider: "AWS",         title: "How to Reduce AWS EC2 Costs by 40% This Week",                      saving: "15–40%",  keyword: "Reduce AWS EC2 costs" },
  { slug: "aws-reserved-instances-guide",     provider: "AWS",         title: "AWS Reserved Instances vs On-Demand: The Real Numbers",             saving: "20–45%",  keyword: "AWS Reserved Instances savings" },
  { slug: "aws-s3-cost-reduction",            provider: "AWS",         title: "How to Cut AWS S3 Costs by 60% With Lifecycle Policies",            saving: "30–60%",  keyword: "Reduce AWS S3 storage costs" },
  { slug: "aws-rds-dev-staging-cost",         provider: "AWS",         title: "Stop Paying Full Price for Dev RDS — Auto-Shutdown Guide",          saving: "40–70%",  keyword: "AWS RDS dev staging costs too high" },
  { slug: "aws-spot-instances-guide",         provider: "AWS",         title: "How to Save 80% on AWS Compute Using Spot Instances",               saving: "60–80%",  keyword: "AWS Spot instances save money" },
  { slug: "aws-unattached-ebs-volumes",       provider: "AWS",         title: "Find and Delete Orphaned AWS EBS Volumes (Saving Guide)",           saving: "5–20%",   keyword: "AWS EBS volumes wasting money" },
  { slug: "aws-data-transfer-costs",          provider: "AWS",         title: "How to Slash AWS Data Transfer Costs With CloudFront",              saving: "10–35%",  keyword: "Reduce AWS data transfer costs" },
  { slug: "aws-elastic-ip-charges",           provider: "AWS",         title: "Why AWS Charges for Elastic IPs (And How to Stop It)",             saving: "1–5%",    keyword: "AWS Elastic IP charges" },
  { slug: "aws-billing-alerts-setup",         provider: "AWS",         title: "How to Set Up AWS Budget Alerts in 5 Minutes",                     saving: "5–20%",   keyword: "Setup AWS billing alerts" },
  { slug: "aws-old-generation-instances",     provider: "AWS",         title: "Migrate From m4/c4 to m7/c7 Instances and Save 15%",               saving: "5–15%",   keyword: "AWS old generation instances cost" },
  { slug: "aws-dev-environment-costs",        provider: "AWS",         title: "Your Dev Environment Shouldn't Cost as Much as Production",        saving: "30–50%",  keyword: "AWS dev environment too expensive" },
  { slug: "aws-load-balancer-costs",          provider: "AWS",         title: "Stop Paying for Idle AWS Load Balancers",                          saving: "3–10%",   keyword: "AWS load balancer idle cost" },
  { slug: "aws-snapshot-cleanup",             provider: "AWS",         title: "AWS Snapshot Retention Policy: Stop the Silent Cost Drain",        saving: "5–15%",   keyword: "AWS snapshot costs reduce" },
  { slug: "aws-cost-optimization-checklist",  provider: "AWS",         title: "Free AWS Cost Optimisation Checklist 2026 — 18 Checks, 20-45% Savings", saving: "20–45%",  keyword: "AWS cost optimization checklist 2026" },
  // GCP Cost (10)
  { slug: "gcp-cost-optimization",            provider: "GCP",         title: "Google Cloud Cost Optimisation: 10 Ways to Cut Your GCP Bill",     saving: "20–45%",  keyword: "GCP cost optimization guide" },
  { slug: "gcp-committed-use-discounts",      provider: "GCP",         title: "GCP Committed Use Discounts: Save 57% on Compute",                saving: "40–57%",  keyword: "GCP committed use discount savings" },
  { slug: "gcp-storage-class-guide",          provider: "GCP",         title: "GCP Storage Classes: Stop Overpaying for Coldline Data",           saving: "30–60%",  keyword: "GCP storage class cost saving" },
  { slug: "gcp-idle-vm-detection",            provider: "GCP",         title: "Detect and Stop Idle GCP VMs Draining Your Budget",                saving: "20–50%",  keyword: "GCP idle VM cost reduction" },
  { slug: "gcp-bigquery-cost-control",        provider: "GCP",         title: "BigQuery Cost Control: Stop Paying for Unused Slots",              saving: "20–40%",  keyword: "Reduce BigQuery costs GCP" },
  { slug: "gcp-preemptible-vms",              provider: "GCP",         title: "GCP Preemptible VMs: Cut Compute Costs by 80%",                    saving: "60–80%",  keyword: "GCP preemptible VMs cost saving" },
  { slug: "gcp-network-egress-costs",         provider: "GCP",         title: "Reduce GCP Network Egress Costs With Cloud CDN",                   saving: "10–30%",  keyword: "Reduce GCP egress costs" },
  { slug: "gcp-sustained-use-discounts",      provider: "GCP",         title: "Maximise GCP Sustained Use Discounts: The Complete Guide",         saving: "20–30%",  keyword: "GCP sustained use discount guide" },
  { slug: "gcp-cloud-run-optimization",       provider: "GCP",         title: "GCP Cloud Run Cost Optimization: Stop Over-Provisioning",          saving: "20–40%",  keyword: "GCP Cloud Run cost optimization" },
  { slug: "gcp-billing-export-setup",         provider: "GCP",         title: "GCP Billing Export to BigQuery: Full Setup Guide",                 saving: "5–20%",   keyword: "GCP billing export BigQuery setup" },
  // Azure Cost (10)
  { slug: "azure-cost-optimization",          provider: "Azure",       title: "Azure Cost Optimisation: Cut Your Monthly Bill by 30%",            saving: "20–40%",  keyword: "Azure cost optimization guide" },
  { slug: "fix-azure-vm-costs",               provider: "Azure",       title: "How to Reduce Azure VM Costs by 40% Immediately",                  saving: "15–40%",  keyword: "Reduce Azure VM costs" },
  { slug: "azure-reserved-instances",         provider: "Azure",       title: "Azure Reserved vs Pay-as-you-go: Save 40% on VMs",                saving: "20–45%",  keyword: "Azure Reserved Instances savings" },
  { slug: "azure-blob-storage-cost",          provider: "Azure",       title: "Cut Azure Blob Storage Costs 60% With Lifecycle Management",       saving: "30–60%",  keyword: "Reduce Azure Blob storage costs" },
  { slug: "azure-dev-staging-costs",          provider: "Azure",       title: "Azure Dev/Staging Environments: Stop the 24/7 Billing",           saving: "40–70%",  keyword: "Azure dev environment too expensive" },
  { slug: "azure-advisor-cost-guide",         provider: "Azure",       title: "Azure Advisor Cost Recommendations: What to Act On",               saving: "10–30%",  keyword: "Azure Advisor cost savings" },
  { slug: "azure-hybrid-benefit",             provider: "Azure",       title: "Azure Hybrid Benefit: Save Up to 85% on Windows VMs",             saving: "40–85%",  keyword: "Azure Hybrid Benefit Windows savings" },
  { slug: "azure-spot-vms",                   provider: "Azure",       title: "Azure Spot VMs: Run Workloads for 90% Less",                       saving: "60–90%",  keyword: "Azure Spot VMs cost saving" },
  { slug: "azure-storage-tiers",              provider: "Azure",       title: "Azure Blob Storage Tiers: Move Cold Data and Save Immediately",    saving: "30–60%",  keyword: "Azure blob storage tier optimization" },
  { slug: "azure-cost-management-setup",      provider: "Azure",       title: "Azure Cost Management: Budgets, Alerts, and Reports Setup",        saving: "5–20%",   keyword: "Azure cost management setup guide" },
  // Multi-cloud (5)
  { slug: "cloud-finops-guide",               provider: "Multi-Cloud", title: "The DevOps Team's FinOps Guide: Cut Cloud Costs Without Slowing Down", saving: "20–45%", keyword: "Cloud FinOps guide teams" },
  { slug: "multi-cloud-cost-comparison",      provider: "Multi-Cloud", title: "AWS vs GCP vs Azure Cost Comparison for Common Workloads",         saving: "10–30%",  keyword: "AWS GCP Azure cost comparison" },
  { slug: "cloud-cost-tagging-strategy",      provider: "Multi-Cloud", title: "Cloud Cost Tagging Strategy: Allocate Costs to Teams and Projects", saving: "5–20%",  keyword: "Cloud cost tagging best practices" },
  { slug: "devops-cloud-cost-checklist",      provider: "Multi-Cloud", title: "DevOps Cloud Cost Checklist: 20 Things to Review Every Quarter",   saving: "20–45%",  keyword: "DevOps cloud cost review checklist" },
  { slug: "finops-guide-startups",            provider: "Multi-Cloud", title: "FinOps for Startups: Cut Cloud Costs Without Cutting Features",    saving: "20–45%",  keyword: "FinOps guide for startups" },
  // Security pages (10)
  { slug: "aws-iam-security-audit",           provider: "AWS",         title: "Free AWS IAM Security Audit — Find Overprivileged Roles (15 Min)", saving: null,      keyword: "AWS IAM security audit checklist",         type: "security" },
  { slug: "aws-s3-public-bucket-fix",         provider: "AWS",         title: "Public S3 Buckets: The $4.45M Risk Hiding in Your AWS Account",    saving: null,      keyword: "AWS S3 public bucket security risk",        type: "security" },
  { slug: "aws-cloudtrail-setup",             provider: "AWS",         title: "How to Enable AWS CloudTrail Audit Logging in 5 Minutes",          saving: null,      keyword: "AWS CloudTrail audit logging setup",        type: "security" },
  { slug: "aws-mfa-enforcement-guide",        provider: "AWS",         title: "Enforce MFA for Every AWS IAM User — Step-by-Step Guide",          saving: null,      keyword: "Enforce MFA all AWS IAM users",             type: "security" },
  { slug: "aws-security-group-audit",         provider: "AWS",         title: "AWS Security Groups Open to the Internet: Find and Fix Them",      saving: null,      keyword: "AWS security group 0.0.0.0/0 risk",        type: "security" },
  { slug: "aws-secrets-manager-guide",        provider: "AWS",         title: "Hardcoded AWS Credentials: How to Find and Eliminate Them",        saving: null,      keyword: "Stop hardcoded AWS credentials code",       type: "security" },
  { slug: "gcp-iam-security-checklist",       provider: "GCP",         title: "GCP IAM Security Checklist: 8 Things to Fix Before Your Next Audit", saving: null,    keyword: "GCP IAM security best practices",           type: "security" },
  { slug: "azure-security-posture-review",    provider: "Azure",       title: "Azure Security Posture Review: No Access Required Checklist",      saving: null,      keyword: "Azure security posture assessment",         type: "security" },
  { slug: "cloud-security-audit-checklist",   provider: "Multi-Cloud", title: "Cloud Security Audit Checklist 2026 — 16 Checks for AWS, GCP & Azure", saving: null, keyword: "Cloud security audit checklist 2026",      type: "security" },
  { slug: "devsecops-cloud-checklist",        provider: "Multi-Cloud", title: "DevSecOps Cloud Security Checklist: 16 Controls Every Team Needs", saving: null,     keyword: "DevSecOps cloud security checklist",        type: "security" },
];

// ── GENERATE HTML FOR EACH PAGE ──────────────────────────────────────────────
let generated = 0;

for (const page of SEO_PAGES) {
  const url         = `${BASE}/${page.slug}/`;
  const isSecure    = page.type === 'security';
  const description = isSecure
    ? `${page.title}. Free interactive checklist — complete in 15 minutes, no cloud credentials required. Used by engineers at AWS, GCP and Azure environments. KloudAudit.eu`
    : `${page.title}. Typical savings: ${page.saving} of affected ${page.provider} spend. Free 15-minute audit at KloudAudit.eu — no cloud access required.`;

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "headline": page.title,
    "description": description,
    "url": url,
    "datePublished": "2026-01-01",
    "dateModified": new Date().toISOString().split('T')[0],
    "author": {
      "@type": "Person",
      "name": "Samuel Ayodele Adomeh",
      "url": "https://www.linkedin.com/in/samuel-ayodele-adomeh",
      "jobTitle": "Senior DevOps Engineer"
    },
    "publisher": {
      "@type": "Organization",
      "name": "KloudAudit",
      "url": BASE
    }
  });

  // Replace head tags — replaces existing tags AND injects canonical
  const t = (s) => s.replace(/"/g, '&quot;');
  let html = indexHtml
    .replace(/<link rel="canonical"[^>]*>/g, '') // remove hardcoded canonical
    .replace(/<title>.*?<\/title>/, `<title>${page.title} | KloudAudit</title>`)
    .replace(/<meta name="description"[^>]*\/>/,  `<meta name="description" content="${t(description)}" />`)
    .replace(/<meta name="robots"[^>]*\/>/,       `<meta name="robots" content="index, follow" />`)
    .replace(/<meta property="og:type"[^>]*\/>/,  `<meta property="og:type" content="article" />`)
    .replace(/<meta property="og:url"[^>]*\/>/,   `<meta property="og:url" content="${url}" />`)
    .replace(/<meta property="og:title"[^>]*\/>/,  `<meta property="og:title" content="${t(page.title)} | KloudAudit" />`)
    .replace(/<meta property="og:description"[^>]*\/>/,`<meta property="og:description" content="${t(description)}" />`)
    .replace(/<meta name="twitter:title"[^>]*\/>/,      `<meta name="twitter:title" content="${t(page.title)} | KloudAudit" />`)
    .replace(/<meta name="twitter:description"[^>]*\/>/,`<meta name="twitter:description" content="${t(description)}" />`)
    .replace(/\s*<\/head>/, () =>
      `\n  <link rel="canonical" href="${url}" />` +
      `\n  <script type="application/ld+json">${jsonLd}</script>` +
      `\n</head>`
    );

  // Write to dist/[slug]/index.html
  const dir = path.join(DIST, page.slug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  generated++;
}

// ── Also fix homepage canonical (index.html may have wrong/duplicate canonical) ──
const homepageHtml = indexHtml
  .replace(/<link rel="canonical"[^>]*>/g, '') // remove any existing canonicals
  .replace(/\s*<\/head>/, () =>
    `
  <link rel="canonical" href="${BASE}/" />` +
    `
</head>`
  );
fs.writeFileSync(path.join(DIST, 'index.html'), homepageHtml);
console.log('✅ Homepage canonical fixed');

console.log(`✅ Pre-rendered ${generated} SEO pages to dist/`);
console.log(`   Google will now read static HTML with correct meta tags for each page.`);
console.log(`   No more "redirect" or "canonical" indexing issues.`);

// IndexNow: submit URLs manually via Bing Webmaster Tools → IndexNow tab
