// src/SEOPages.jsx
// 50 programmatic SEO landing pages — each targets a specific search query
// These pages are indexed by Google and drive zero-cost organic traffic

import { useEffect } from "react";

export const SEO_PAGES = [
  // AWS specific
  { slug: "fix-aws-nat-gateway-charges", provider: "AWS", keyword: "Excessive NAT Gateway charges AWS", title: "How to Fix Excessive AWS NAT Gateway Charges", issue: "nat_gateway", saving: "10–30%" },
  { slug: "reduce-aws-ec2-cost", provider: "AWS", keyword: "Reduce AWS EC2 costs", title: "How to Reduce AWS EC2 Costs by 40% This Week", issue: "rightsizing", saving: "15–40%" },
  { slug: "aws-reserved-instances-guide", provider: "AWS", keyword: "AWS Reserved Instances savings", title: "AWS Reserved Instances vs On-Demand: The Real Numbers", issue: "reserved", saving: "20–45%" },
  { slug: "aws-s3-cost-reduction", provider: "AWS", keyword: "Reduce AWS S3 storage costs", title: "How to Cut AWS S3 Costs by 60% With Lifecycle Policies", issue: "s3_tier", saving: "30–60%" },
  { slug: "aws-rds-dev-staging-cost", provider: "AWS", keyword: "AWS RDS dev staging costs too high", title: "Stop Paying Full Price for Dev RDS — Auto-Shutdown Guide", issue: "rds_idle", saving: "40–70%" },
  { slug: "aws-spot-instances-guide", provider: "AWS", keyword: "AWS Spot instances save money", title: "How to Save 80% on AWS Compute Using Spot Instances", issue: "spot", saving: "60–80%" },
  { slug: "aws-unattached-ebs-volumes", provider: "AWS", keyword: "AWS EBS volumes wasting money", title: "Find and Delete Orphaned AWS EBS Volumes (Saving Guide)", issue: "unattached_volumes", saving: "5–20%" },
  { slug: "aws-data-transfer-costs", provider: "AWS", keyword: "Reduce AWS data transfer costs", title: "How to Slash AWS Data Transfer Costs With CloudFront", issue: "data_transfer", saving: "10–35%" },
  { slug: "aws-elastic-ip-charges", provider: "AWS", keyword: "AWS Elastic IP charges", title: "Why AWS Charges for Elastic IPs (And How to Stop It)", issue: "unused_ips", saving: "1–5%" },
  { slug: "aws-billing-alerts-setup", provider: "AWS", keyword: "Setup AWS billing alerts", title: "How to Set Up AWS Budget Alerts in 5 Minutes", issue: "no_budgets", saving: "5–20%" },
  { slug: "aws-old-generation-instances", provider: "AWS", keyword: "AWS old generation instances cost", title: "Migrate From m4/c4 to m7/c7 Instances and Save 15%", issue: "old_gen", saving: "5–15%" },
  { slug: "aws-dev-environment-costs", provider: "AWS", keyword: "AWS dev environment too expensive", title: "Your Dev Environment Shouldn't Cost as Much as Production", issue: "dev_prod_parity", saving: "30–50%" },
  { slug: "aws-load-balancer-costs", provider: "AWS", keyword: "AWS load balancer idle cost", title: "Stop Paying for Idle AWS Load Balancers", issue: "lb_unused", saving: "3–10%" },
  { slug: "aws-snapshot-cleanup", provider: "AWS", keyword: "AWS snapshot costs reduce", title: "AWS Snapshot Retention Policy: Stop the Silent Cost Drain", issue: "snapshots", saving: "5–15%" },
  { slug: "aws-cost-optimization-checklist", provider: "AWS", keyword: "AWS cost optimization checklist 2026", title: "The Complete AWS Cost Optimisation Checklist for 2026", issue: null, saving: "20–45%" },

  // Azure specific
  { slug: "fix-azure-vm-costs", provider: "Azure", keyword: "Reduce Azure VM costs", title: "How to Reduce Azure VM Costs by 40% Immediately", issue: "rightsizing", saving: "15–40%" },
  { slug: "azure-reserved-instances", provider: "Azure", keyword: "Azure Reserved Instances savings", title: "Azure Reserved vs Pay-as-you-go: Save 40% on VMs", issue: "reserved", saving: "20–45%" },
  { slug: "azure-blob-storage-cost", provider: "Azure", keyword: "Reduce Azure Blob storage costs", title: "Cut Azure Blob Storage Costs 60% With Lifecycle Management", issue: "s3_tier", saving: "30–60%" },
  { slug: "azure-dev-staging-costs", provider: "Azure", keyword: "Azure dev environment too expensive", title: "Azure Dev/Staging Environments: Stop the 24/7 Billing", issue: "rds_idle", saving: "40–70%" },
  { slug: "azure-spot-vms-guide", provider: "Azure", keyword: "Azure Spot VMs save money", title: "Azure Spot VMs: Save 80% on Non-Critical Workloads", issue: "spot", saving: "60–80%" },
  { slug: "azure-unmanaged-disks", provider: "Azure", keyword: "Azure orphaned managed disks", title: "Find and Delete Orphaned Azure Managed Disks", issue: "unattached_volumes", saving: "5–20%" },
  { slug: "azure-egress-cost-reduction", provider: "Azure", keyword: "Reduce Azure egress costs", title: "Azure CDN vs Direct Egress: The Cost Difference Is Massive", issue: "data_transfer", saving: "10–35%" },
  { slug: "azure-sql-rightsizing", provider: "Azure", keyword: "Azure SQL database too expensive", title: "Is Your Azure SQL Over-Provisioned? Here's How to Check", issue: "rds_size", saving: "20–40%" },
  { slug: "azure-cost-alerts-setup", provider: "Azure", keyword: "Azure cost alerts setup", title: "Set Up Azure Cost Management Alerts in 10 Minutes", issue: "no_budgets", saving: "5–20%" },
  { slug: "azure-nat-gateway-costs", provider: "Azure", keyword: "Azure NAT Gateway expensive", title: "Azure NAT Gateway Costing Too Much? Here's the Fix", issue: "nat_gateway", saving: "10–30%" },
  { slug: "azure-cost-optimization-2026", provider: "Azure", keyword: "Azure cost optimization 2026", title: "The Complete Azure Cost Optimisation Guide for 2026", issue: null, saving: "20–45%" },

  // GCP specific
  { slug: "reduce-gcp-compute-costs", provider: "GCP", keyword: "Reduce Google Cloud compute costs", title: "How to Reduce GCP Compute Engine Costs by 40%", issue: "rightsizing", saving: "15–40%" },
  { slug: "gcp-committed-use-discounts", provider: "GCP", keyword: "GCP committed use discounts", title: "GCP Committed Use Discounts: Save 40–70% on Compute", issue: "reserved", saving: "20–45%" },
  { slug: "gcp-cloud-storage-costs", provider: "GCP", keyword: "Reduce GCP Cloud Storage costs", title: "GCP Storage Classes Explained: Stop Paying Hot Prices", issue: "s3_tier", saving: "30–60%" },
  { slug: "gcp-preemptible-vms", provider: "GCP", keyword: "GCP Preemptible VMs save money", title: "GCP Preemptible VMs: 80% Cheaper Compute for Batch Jobs", issue: "spot", saving: "60–80%" },
  { slug: "gcp-cloudsql-costs", provider: "GCP", keyword: "GCP Cloud SQL too expensive", title: "Is Your GCP Cloud SQL Over-Sized? A Rightsizing Guide", issue: "rds_size", saving: "20–40%" },
  { slug: "gcp-egress-costs", provider: "GCP", keyword: "Reduce GCP egress costs", title: "GCP Egress Costs: Why They're High and How to Fix Them", issue: "data_transfer", saving: "10–35%" },
  { slug: "gcp-billing-budgets", provider: "GCP", keyword: "GCP billing budget alerts", title: "GCP Budget Alerts Setup: Never Get Surprised Again", issue: "no_budgets", saving: "5–20%" },
  { slug: "gcp-cost-optimization-2026", provider: "GCP", keyword: "GCP cost optimization 2026", title: "The Complete GCP Cost Optimisation Guide for 2026", issue: null, saving: "20–45%" },

  // General DevOps / FinOps
  { slug: "cloud-cost-audit-guide", provider: "Multi-cloud", keyword: "how to audit cloud costs", title: "How to Audit Your Cloud Costs: A DevOps Engineer's Guide", issue: null, saving: "20–45%" },
  { slug: "cloud-bill-too-high", provider: "Multi-cloud", keyword: "cloud bill too high what to do", title: "Cloud Bill Too High? Here's Exactly What to Do", issue: null, saving: "20–45%" },
  { slug: "finops-guide-startups", provider: "Multi-cloud", keyword: "FinOps guide for startups", title: "FinOps for Startups: Cut Cloud Costs Without Cutting Features", issue: null, saving: "20–45%" },
  { slug: "cloud-cost-waste-common", provider: "Multi-cloud", keyword: "common cloud cost waste", title: "The 9 Most Common Cloud Cost Leaks (And How to Fix Them)", issue: null, saving: "20–45%" },
  { slug: "devops-cost-optimization", provider: "Multi-cloud", keyword: "DevOps cloud cost optimization", title: "DevOps Engineer's Complete Cloud Cost Optimisation Guide", issue: null, saving: "20–45%" },
  { slug: "cloud-costs-poland", provider: "Multi-cloud", keyword: "cloud cost consulting Poland", title: "Cloud Cost Optimisation for Companies in Poland", issue: null, saving: "20–45%" },
  { slug: "aws-bill-jumped", provider: "AWS", keyword: "AWS bill suddenly increased", title: "AWS Bill Suddenly Jumped? Here's How to Find the Cause", issue: null, saving: "20–45%" },
  { slug: "cloud-cost-saving-tips-2026", provider: "Multi-cloud", keyword: "cloud cost saving tips 2026", title: "15 Cloud Cost Saving Tips That Actually Work in 2026", issue: null, saving: "20–45%" },
  { slug: "infrastructure-cost-reduction", provider: "Multi-cloud", keyword: "reduce infrastructure costs", title: "How to Reduce Infrastructure Costs by 30% in 30 Days", issue: null, saving: "20–45%" },
  { slug: "kubernetes-cost-optimization", provider: "Multi-cloud", keyword: "Kubernetes cost optimization", title: "Kubernetes Cost Optimisation: Right-Size Your Clusters", issue: null, saving: "20–45%" },
  { slug: "terraform-cost-estimation", provider: "Multi-cloud", keyword: "Terraform cost estimation before deploy", title: "Terraform Cost Estimation: Know Your Bill Before You Deploy", issue: null, saving: "20–45%" },
  { slug: "cloud-cost-monitoring-tools", provider: "Multi-cloud", keyword: "best cloud cost monitoring tools 2026", title: "Best Cloud Cost Monitoring Tools in 2026 (Compared)", issue: null, saving: "20–45%" },
  { slug: "azure-vs-aws-costs", provider: "Multi-cloud", keyword: "Azure vs AWS cost comparison", title: "Azure vs AWS vs GCP: Real Cost Comparison for 2026", issue: null, saving: "20–45%" },
  { slug: "cloud-cost-per-engineer", provider: "Multi-cloud", keyword: "cloud cost per engineer team", title: "What Should Cloud Cost Per Engineer? Benchmarks for 2026", issue: null, saving: "20–45%" },
  { slug: "startup-cloud-costs", provider: "Multi-cloud", keyword: "startup cloud costs too high", title: "Why Your Startup's Cloud Bill Is Too High (And the Fix)", issue: null, saving: "20–45%" },

  // ── SECURITY SEO PAGES ─────────────────────────────────────────────────────
  { slug: "aws-iam-security-audit", provider: "AWS", keyword: "AWS IAM security audit checklist", title: "AWS IAM Security Audit: Find Overprivileged Roles in 15 Minutes", issue: "iam_wildcards", saving: null, type: "security" },
  { slug: "aws-s3-public-bucket-fix", provider: "AWS", keyword: "AWS S3 public bucket security risk", title: "Public S3 Buckets: The $4.45M Risk Hiding in Your AWS Account", issue: "public_buckets", saving: null, type: "security" },
  { slug: "aws-cloudtrail-setup", provider: "AWS", keyword: "AWS CloudTrail audit logging setup", title: "How to Enable AWS CloudTrail Audit Logging in 5 Minutes", issue: "no_cloudtrail", saving: null, type: "security" },
  { slug: "aws-mfa-enforcement-guide", provider: "AWS", keyword: "Enforce MFA all AWS IAM users", title: "Enforce MFA for Every AWS IAM User — Step-by-Step Guide", issue: "mfa_all", saving: null, type: "security" },
  { slug: "aws-security-group-audit", provider: "AWS", keyword: "AWS security group 0.0.0.0/0 risk", title: "AWS Security Groups Open to the Internet: Find and Fix Them", issue: "open_security_groups", saving: null, type: "security" },
  { slug: "aws-secrets-manager-guide", provider: "AWS", keyword: "Stop hardcoded AWS credentials code", title: "Hardcoded AWS Credentials: How to Find and Eliminate Them", issue: "hardcoded_secrets", saving: null, type: "security" },
  { slug: "gcp-iam-security-checklist", provider: "GCP", keyword: "GCP IAM security best practices", title: "GCP IAM Security Checklist: 8 Things to Fix Before Your Next Audit", issue: "iam_wildcards", saving: null, type: "security" },
  { slug: "azure-security-posture-review", provider: "Azure", keyword: "Azure security posture assessment", title: "Azure Security Posture Review: No Access Required Checklist", issue: "mfa_all", saving: null, type: "security" },
  { slug: "cloud-security-audit-checklist", provider: "Multi-Cloud", keyword: "Cloud security audit checklist 2026", title: "The Complete Cloud Security Audit Checklist for AWS, GCP & Azure (2026)", issue: null, saving: null, type: "security" },
  { slug: "devsecops-cloud-checklist", provider: "Multi-Cloud", keyword: "DevSecOps cloud security checklist", title: "DevSecOps Cloud Security Checklist: 16 Controls Every Team Needs", issue: null, saving: null, type: "security" },
];

// ── SEO Head injector — sets real <title>, <meta>, canonical, JSON-LD ──────
function useSEOHead(page) {
  useEffect(() => {
    const BASE = "https://kloudaudit.eu";
    const canonicalUrl = `${BASE}/${page.slug}/`;
    const description = `${page.title}. Typical savings: ${page.saving} of affected ${page.provider} spend. Free 15-minute audit at KloudAudit.eu — no cloud access required.`;

    // ── <title> ────────────────────────────────────────────────────────────
    document.title = `${page.title} | KloudAudit`;

    // ── helper: upsert a <meta> tag ────────────────────────────────────────
    const setMeta = (attr, key, content) => {
      let el = document.querySelector(`meta[${attr}="${key}"]`);
      if (!el) { el = document.createElement("meta"); el.setAttribute(attr, key); document.head.appendChild(el); }
      el.setAttribute("content", content);
    };

    // ── helper: upsert a <link> tag ────────────────────────────────────────
    const setLink = (rel, href) => {
      let el = document.querySelector(`link[rel="${rel}"]`);
      if (!el) { el = document.createElement("link"); el.setAttribute("rel", rel); document.head.appendChild(el); }
      el.setAttribute("href", href);
    };

    // Standard meta
    setMeta("name", "description", description);
    setMeta("name", "robots", "index, follow");
    setMeta("name", "author", "Samuel Ayodele Adomeh · KloudAudit.eu");

    // Open Graph
    setMeta("property", "og:type", "article");
    setMeta("property", "og:url", canonicalUrl);
    setMeta("property", "og:title", `${page.title} | KloudAudit`);
    setMeta("property", "og:description", description);
    setMeta("property", "og:image", `${BASE}/android-chrome-512x512.png`);
    setMeta("property", "og:site_name", "KloudAudit");

    // Twitter
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", `${page.title} | KloudAudit`);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", `${BASE}/android-chrome-512x512.png`);

    // Canonical
    setLink("canonical", canonicalUrl);

    // ── JSON-LD structured data ────────────────────────────────────────────
    const jsonld = {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      "headline": page.title,
      "description": description,
      "url": canonicalUrl,
      "datePublished": "2026-01-01",
      "dateModified": new Date().toISOString().split("T")[0],
      "author": {
        "@type": "Person",
        "name": "Samuel Ayodele Adomeh",
        "url": "https://www.linkedin.com/in/samuel-ayodele-adomeh",
        "jobTitle": "Senior DevOps Engineer",
        "worksFor": { "@type": "Organization", "name": "KloudAudit", "url": BASE }
      },
      "publisher": {
        "@type": "Organization",
        "name": "KloudAudit",
        "url": BASE,
        "logo": { "@type": "ImageObject", "url": `${BASE}/android-chrome-192x192.png` }
      },
      "about": { "@type": "Thing", "name": `${page.provider} cloud cost optimisation` },
      "keywords": `${page.keyword}, cloud cost optimisation, ${page.provider} costs, FinOps, DevOps`,
      "breadcrumb": {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "KloudAudit", "item": BASE },
          { "@type": "ListItem", "position": 2, "name": page.provider, "item": `${BASE}/#${page.provider.toLowerCase()}` },
          { "@type": "ListItem", "position": 3, "name": page.title, "item": canonicalUrl }
        ]
      }
    };

    let scriptEl = document.querySelector('script[data-seo="kloudaudit-page"]');
    if (!scriptEl) { scriptEl = document.createElement("script"); scriptEl.setAttribute("type", "application/ld+json"); scriptEl.setAttribute("data-seo", "kloudaudit-page"); document.head.appendChild(scriptEl); }
    scriptEl.textContent = JSON.stringify(jsonld, null, 2);

    // ── Push real URL to browser history so Googlebot sees the slug ────────
    const targetPath = `/${page.slug}/`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ slug: page.slug }, document.title, targetPath);
    }

    // ── Cleanup on unmount: restore homepage title/canonical ───────────────
    return () => {
      document.title = "KloudAudit — Find What Your Cloud Bill Is Hiding";
      setMeta("name", "description", "A structured 15-minute audit that uncovers real savings in your AWS, GCP, or Azure spend. No agents. No access required.");
      setLink("canonical", `${BASE}/`);
      const s = document.querySelector('script[data-seo="kloudaudit-page"]');
      if (s) s.remove();
      if (window.location.pathname !== "/") {
        window.history.pushState({}, document.title, "/");
      }
    };
  }, [page.slug]);
}

// ── SEO Page Component ─────────────────────────────────────────────────────
export default function SEOPage({ page, onStartAudit }) {
  // Inject all SEO tags and set real URL
  useSEOHead(page);

  const isAWS = page.provider === "AWS";
  const isAzure = page.provider === "Azure";
  const isGCP = page.provider === "GCP";

  const providerColor = isAWS ? "#FF9900" : isAzure ? "#0078D4" : isGCP ? "#4285F4" : "#00ffb4";
  const providerBg = isAWS ? "rgba(255,153,0,0.1)" : isAzure ? "rgba(0,120,212,0.1)" : isGCP ? "rgba(66,133,244,0.1)" : "rgba(0,255,180,0.1)";

  const tips = {
    nat_gateway: [
      "Use VPC endpoints for S3 and DynamoDB — eliminates NAT charges for those services entirely",
      "Route internal traffic between services in the same VPC directly — no NAT needed",
      "Consider AWS PrivateLink for cross-VPC communication instead of routing through NAT",
      "Monitor NAT Gateway data processed metrics in CloudWatch to identify the biggest traffic sources",
    ],
    rightsizing: [
      "Use AWS Compute Optimizer or Azure Advisor to get machine-learning-based resize recommendations",
      "Monitor CPU, memory, and network utilisation for 2 weeks before making any sizing decisions",
      "Consider Graviton/Ampere instances — same performance, 20% cheaper on AWS",
      "Schedule non-production instances to stop outside business hours using Lambda or Azure Automation",
    ],
    reserved: [
      "Start with 1-year No Upfront reservations to reduce risk — you can always upgrade to 3-year later",
      "Use AWS Savings Plans instead of Reserved Instances for more flexibility across instance families",
      "Analyse your last 90 days of usage before committing — look for stable baseline workloads only",
      "Reservations work best for workloads running more than 60% of the time",
    ],
    s3_tier: [
      "Enable S3 Intelligent-Tiering for data with unknown or changing access patterns",
      "Set lifecycle rules: Standard → Standard-IA after 30 days → Glacier after 90 days",
      "Use S3 Storage Lens to analyse access patterns across all buckets before configuring tiers",
      "Glacier Instant Retrieval is often the sweet spot for backups — millisecond access, 68% cheaper",
    ],
    rds_idle: [
      "Use RDS auto-stop for dev/test databases — they restart automatically when you reconnect",
      "Schedule start/stop with AWS Lambda + EventBridge for databases that don't support auto-stop",
      "Consider Aurora Serverless v2 for dev environments — scales to zero when idle",
      "Use smaller instance classes for dev — a db.t3.micro handles most development workloads fine",
    ],
    spot: [
      "Use Spot for: CI/CD runners, batch processing, ML training, data pipelines — anything that can retry",
      "Mix On-Demand and Spot with capacity-optimised allocation strategy to minimise interruptions",
      "AWS EC2 Spot interruption rate is only 5% on average — much lower than most teams think",
      "Save Spot interruption notices to S3 for analysis — helps you pick the best instance types",
    ],
  };

  const pageTips = page.issue && tips[page.issue] ? tips[page.issue] : [
    "Audit your cloud bill monthly — costs drift silently without regular review",
    "Tag all resources with project and environment — untagged resources are invisible costs",
    "Set budget alerts at 80% of your monthly target — catch overruns before they compound",
    "Review reserved instance utilisation quarterly — underutilised RIs are wasted commitments",
  ];

  const cliSnippet = {
    AWS: {
      nat_gateway: `# Find NAT Gateway data processed costs\naws cloudwatch get-metric-statistics \\\n  --namespace AWS/NatGateway \\\n  --metric-name BytesOutToDestination \\\n  --period 86400 --statistics Sum \\\n  --start-time $(date -d '30 days ago' +%Y-%m-%dT%H:%M:%S) \\\n  --end-time $(date +%Y-%m-%dT%H:%M:%S)\n\n# Create VPC endpoint for S3 (eliminates NAT charges)\naws ec2 create-vpc-endpoint \\\n  --vpc-id vpc-xxxxxxxx \\\n  --service-name com.amazonaws.eu-west-1.s3 \\\n  --route-table-ids rtb-xxxxxxxx`,
      rightsizing: `# Get Compute Optimizer recommendations\naws compute-optimizer get-ec2-instance-recommendations \\\n  --filters name=Finding,values=Overprovisioned \\\n  --query 'instanceRecommendations[*].{Instance:instanceArn,Current:currentInstanceType,Recommended:recommendationOptions[0].instanceType,Saving:recommendationOptions[0].estimatedMonthlySavings}' \\\n  --output table`,
      reserved: `# Analyse on-demand spend for reservation candidates\naws ce get-reservation-purchase-recommendation \\\n  --service EC2 \\\n  --lookback-period-in-days SIXTY_DAYS \\\n  --term-in-years ONE_YEAR \\\n  --payment-option NO_UPFRONT \\\n  --query 'Recommendations[*].{InstanceType:RecommendationDetails[0].InstanceDetails.EC2InstanceDetails.InstanceType,MonthlySaving:RecommendationSummary.EstimatedMonthlySavingsAmount}' \\\n  --output table`,
      s3_tier: `# Enable Intelligent Tiering on existing bucket\naws s3api put-bucket-intelligent-tiering-configuration \\\n  --bucket your-bucket-name \\\n  --id EntireBucket \\\n  --intelligent-tiering-configuration '{"Id":"EntireBucket","Status":"Enabled","Tierings":[{"Days":90,"AccessTier":"ARCHIVE_ACCESS"}]}'\n\n# Add lifecycle rule: move to IA after 30 days\naws s3api put-bucket-lifecycle-configuration \\\n  --bucket your-bucket-name \\\n  --lifecycle-configuration file://lifecycle.json`,
    },
    Azure: {
      rightsizing: `# Get Azure Advisor cost recommendations\naz advisor recommendation list \\\n  --category Cost \\\n  --query '[].{Title:shortDescription.solution,Impact:impact,Savings:extendedProperties.annualSavingsAmount}' \\\n  --output table\n\n# Resize a VM\naz vm resize \\\n  --resource-group myRG \\\n  --name myVM \\\n  --size Standard_D2s_v5`,
      s3_tier: `# Set blob lifecycle management\naz storage account management-policy create \\\n  --account-name mystorageaccount \\\n  --resource-group myRG \\\n  --policy @lifecycle-policy.json`,
    },
    GCP: {
      rightsizing: `# Get GCP recommender suggestions\ngcloud recommender recommendations list \\\n  --recommender=google.compute.instance.MachineTypeRecommender \\\n  --location=us-central1-a \\\n  --format='table(recommenderSubtype,content.overview.errorEstimation.monthlySavings.amount)'`,
    },
  };

  const snippet = page.issue && cliSnippet[page.provider]?.[page.issue]
    ? cliSnippet[page.provider][page.issue]
    : `# Run a full audit of your ${page.provider} costs\n# Visit kloudaudit.eu for a free 15-minute audit\n# Get an AI-generated fix guide with exact commands for your specific issues`;

  return (
    <div style={{ maxWidth: "860px", margin: "0 auto", padding: "88px 24px 80px", position: "relative", zIndex: 1 }}>

      {/* Breadcrumb — visible to Google */}
      <nav aria-label="breadcrumb" style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "32px", fontSize: "13px", color: "var(--text-muted)" }}>
        <a href="https://kloudaudit.eu/" onClick={e => { e.preventDefault(); onStartAudit(); }} style={{ color: "var(--green)", textDecoration: "none" }}>KloudAudit</a>
        <span aria-hidden="true">›</span>
        <span style={{ color: providerColor }}>{page.provider}</span>
        <span aria-hidden="true">›</span>
        <span>{page.title}</span>
      </nav>

      {/* Header */}
      <div style={{ marginBottom: "40px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: providerBg, border: `1px solid ${providerColor}40`, borderRadius: "20px", padding: "5px 14px", marginBottom: "20px" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: providerColor, letterSpacing: "1px" }}>{page.provider} · Cost Guide</span>
        </div>
        <h1 className="display" style={{ fontSize: "clamp(26px,4vw,44px)", fontWeight: 800, letterSpacing: "-1.5px", color: "#fff", lineHeight: 1.1, marginBottom: "16px" }}>
          {page.title}
        </h1>
        <p style={{ fontSize: "17px", color: "var(--text-muted)", lineHeight: 1.7, maxWidth: "620px" }}>
          This guide covers how to identify, diagnose, and fix this specific {page.provider} cost issue. Typical savings: <strong style={{ color: "var(--green)" }}>{page.saving}</strong> of the affected spend.
        </p>
      </div>

      {/* Free audit CTA */}
      <div style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.08) 0%, rgba(99,102,241,0.08) 100%)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "16px", padding: "24px 28px", marginBottom: "40px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--green)", marginBottom: "4px" }}>⚡ Not sure if this applies to you?</p>
          <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>Run a free 15-minute audit and see exactly which issues your infrastructure has — with savings estimates.</p>
        </div>
        <button className="glow-btn" onClick={onStartAudit}
          style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "12px 24px", fontSize: "14px", fontWeight: 700, whiteSpace: "nowrap", cursor: "pointer" }}>
          Free Audit →
        </button>
      </div>

      {/* Tips */}
      <div style={{ marginBottom: "36px" }}>
        <h2 className="display" style={{ fontSize: "20px", fontWeight: 700, color: "#fff", marginBottom: "20px", letterSpacing: "-0.3px" }}>
          How to Fix This
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {pageTips.map((tip, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "14px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px" }}>
              <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "var(--green-dim)", border: "1px solid var(--green-border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span className="display" style={{ fontSize: "12px", fontWeight: 800, color: "var(--green)" }}>{i + 1}</span>
              </div>
              <p style={{ fontSize: "14px", color: "var(--text-dim)", lineHeight: 1.6, margin: 0 }}>{tip}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CLI snippet */}
      <div style={{ marginBottom: "36px" }}>
        <h2 className="display" style={{ fontSize: "20px", fontWeight: 700, color: "#fff", marginBottom: "16px", letterSpacing: "-0.3px" }}>
          CLI Commands to Get Started
        </h2>
        <div style={{ background: "#0a0a14", border: "1px solid rgba(0,255,180,0.15)", borderRadius: "12px", overflow: "hidden" }}>
          <div style={{ background: "#12121f", padding: "10px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#f87171" }} />
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#fbbf24" }} />
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#4ade80" }} />
            <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "8px" }}>{page.provider} CLI</span>
          </div>
          <pre style={{ padding: "20px", margin: 0, fontSize: "12px", color: "#4ade80", fontFamily: "'DM Mono', monospace", overflowX: "auto", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {snippet}
          </pre>
        </div>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "10px" }}>
          💡 Need the full implementation guide with Terraform, step-by-step instructions, and commands tailored to your specific setup? Get the AI Blueprint for 299 PLN.
        </p>
      </div>

      {/* Blueprint upsell */}
      <div style={{ background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "16px", padding: "32px", marginBottom: "36px", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "20px", padding: "4px 14px", marginBottom: "16px" }}>
          <span style={{ fontSize: "11px", color: "var(--green)", fontWeight: 700, letterSpacing: "1px" }}>AI IMPLEMENTATION BLUEPRINT · 299 PLN</span>
        </div>
        <h3 className="display" style={{ fontSize: "22px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", marginBottom: "10px" }}>
          Get the complete fix guide for your specific setup
        </h3>
        <p style={{ fontSize: "14px", color: "var(--text-muted)", marginBottom: "20px", maxWidth: "480px", margin: "0 auto 20px" }}>
          Run the free audit, then get an AI-generated PDF with exact CLI commands, Terraform snippets, and step-by-step instructions tailored to your flagged issues. Delivered to your inbox in minutes.
        </p>
        <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap", marginBottom: "20px" }}>
          {["✓ Exact CLI commands", "✓ Terraform snippets", "✓ Step-by-step guide", "✓ Instant PDF delivery"].map(f => (
            <span key={f} style={{ fontSize: "12px", color: "var(--green)", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "6px", padding: "4px 10px" }}>{f}</span>
          ))}
        </div>
        <button className="glow-btn" onClick={onStartAudit}
          style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "14px 32px", fontSize: "15px", fontWeight: 700, cursor: "pointer", boxShadow: "0 0 24px rgba(0,255,180,0.3)" }}>
          Start Free Audit → Get Blueprint
        </button>
      </div>

      {/* Internal links — real <a> tags for Google to follow */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "28px" }}>
        <p style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "16px" }}>Related Guides</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          {SEO_PAGES.filter(p => p.slug !== page.slug && p.provider === page.provider).slice(0, 5).map(related => (
            <a
              key={related.slug}
              href={`https://kloudaudit.eu/${related.slug}/`}
              onClick={e => { e.preventDefault(); window.dispatchEvent(new CustomEvent('navigateSEO', { detail: related })); }}
              style={{ fontSize: "13px", color: "var(--green)", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "8px", padding: "6px 14px", cursor: "pointer", fontFamily: "inherit", textDecoration: "none", transition: "all 0.15s" }}>
              {related.title.substring(0, 48)}{related.title.length > 48 ? "…" : ""}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
