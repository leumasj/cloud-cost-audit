// scripts/prerender.js
// Generates static HTML pages for all 50 SEO landing pages.
const fs   = require('fs');
const path = require('path');

const BASE  = 'https://www.kloudaudit.eu';
const DIST  = path.join(__dirname, '..', 'dist');
const INDEX = path.join(DIST, 'index.html');

if (!fs.existsSync(INDEX)) {
  console.error('dist/index.html not found — run vite build first');
  process.exit(1);
}

const indexHtml = fs.readFileSync(INDEX, 'utf8');

const SEO_PAGES = [
  // AWS Cost (15)
  { slug: "fix-aws-nat-gateway-charges",      provider: "AWS",         title: "How to Fix Excessive AWS NAT Gateway Charges",                           saving: "10-30%",  keyword: "Excessive NAT Gateway charges AWS" },
  { slug: "reduce-aws-ec2-cost",              provider: "AWS",         title: "How to Reduce AWS EC2 Costs by 40% This Week",                           saving: "15-40%",  keyword: "Reduce AWS EC2 costs" },
  { slug: "aws-reserved-instances-guide",     provider: "AWS",         title: "AWS Reserved Instances vs On-Demand: The Real Numbers",                  saving: "20-45%",  keyword: "AWS Reserved Instances savings" },
  { slug: "aws-s3-cost-reduction",            provider: "AWS",         title: "How to Cut AWS S3 Costs by 60% With Lifecycle Policies",                 saving: "30-60%",  keyword: "Reduce AWS S3 storage costs" },
  { slug: "aws-rds-dev-staging-cost",         provider: "AWS",         title: "Stop Paying Full Price for Dev RDS Auto-Shutdown Guide",                 saving: "40-70%",  keyword: "AWS RDS dev staging costs too high" },
  { slug: "aws-spot-instances-guide",         provider: "AWS",         title: "How to Save 80% on AWS Compute Using Spot Instances",                    saving: "60-80%",  keyword: "AWS Spot instances save money" },
  { slug: "aws-unattached-ebs-volumes",       provider: "AWS",         title: "Find and Delete Orphaned AWS EBS Volumes Saving Guide",                  saving: "5-20%",   keyword: "AWS EBS volumes wasting money" },
  { slug: "aws-data-transfer-costs",          provider: "AWS",         title: "How to Slash AWS Data Transfer Costs With CloudFront",                   saving: "10-35%",  keyword: "Reduce AWS data transfer costs" },
  { slug: "aws-elastic-ip-charges",           provider: "AWS",         title: "Why AWS Charges for Elastic IPs And How to Stop It",                    saving: "1-5%",    keyword: "AWS Elastic IP charges" },
  { slug: "aws-billing-alerts-setup",         provider: "AWS",         title: "How to Set Up AWS Budget Alerts in 5 Minutes",                          saving: "5-20%",   keyword: "Setup AWS billing alerts" },
  { slug: "aws-old-generation-instances",     provider: "AWS",         title: "Migrate From m4/c4 to m7/c7 Instances and Save 15%",                    saving: "5-15%",   keyword: "AWS old generation instances cost" },
  { slug: "aws-dev-environment-costs",        provider: "AWS",         title: "Your Dev Environment Should Not Cost as Much as Production",            saving: "30-50%",  keyword: "AWS dev environment too expensive" },
  { slug: "aws-load-balancer-costs",          provider: "AWS",         title: "Stop Paying for Idle AWS Load Balancers",                               saving: "3-10%",   keyword: "AWS load balancer idle cost" },
  { slug: "aws-snapshot-cleanup",             provider: "AWS",         title: "AWS Snapshot Retention Policy Stop the Silent Cost Drain",              saving: "5-15%",   keyword: "AWS snapshot costs reduce" },
  { slug: "aws-cost-optimization-checklist",  provider: "AWS",         title: "Free AWS Cost Optimisation Checklist 2026 18 Checks 20-45% Savings",    saving: "20-45%",  keyword: "AWS cost optimization checklist 2026" },
  // GCP Cost (10)
  { slug: "gcp-cost-optimization",            provider: "GCP",         title: "Google Cloud Cost Optimisation 10 Ways to Cut Your GCP Bill",           saving: "20-45%",  keyword: "GCP cost optimization guide" },
  { slug: "gcp-committed-use-discounts",      provider: "GCP",         title: "GCP Committed Use Discounts Save 57% on Compute",                      saving: "40-57%",  keyword: "GCP committed use discount savings" },
  { slug: "gcp-storage-class-guide",          provider: "GCP",         title: "GCP Storage Classes Stop Overpaying for Coldline Data",                 saving: "30-60%",  keyword: "GCP storage class cost saving" },
  { slug: "gcp-idle-vm-detection",            provider: "GCP",         title: "Detect and Stop Idle GCP VMs Draining Your Budget",                     saving: "20-50%",  keyword: "GCP idle VM cost reduction" },
  { slug: "gcp-bigquery-cost-control",        provider: "GCP",         title: "BigQuery Cost Control Stop Paying for Unused Slots",                    saving: "20-40%",  keyword: "Reduce BigQuery costs GCP" },
  { slug: "gcp-preemptible-vms",              provider: "GCP",         title: "GCP Preemptible VMs Cut Compute Costs by 80%",                          saving: "60-80%",  keyword: "GCP preemptible VMs cost saving" },
  { slug: "gcp-network-egress-costs",         provider: "GCP",         title: "Reduce GCP Network Egress Costs With Cloud CDN",                        saving: "10-30%",  keyword: "Reduce GCP egress costs" },
  { slug: "gcp-sustained-use-discounts",      provider: "GCP",         title: "Maximise GCP Sustained Use Discounts The Complete Guide",               saving: "20-30%",  keyword: "GCP sustained use discount guide" },
  { slug: "gcp-cloud-run-optimization",       provider: "GCP",         title: "GCP Cloud Run Cost Optimization Stop Over-Provisioning",                saving: "20-40%",  keyword: "GCP Cloud Run cost optimization" },
  { slug: "gcp-billing-export-setup",         provider: "GCP",         title: "GCP Billing Export to BigQuery Full Setup Guide",                       saving: "5-20%",   keyword: "GCP billing export BigQuery setup" },
  // Azure Cost (10)
  { slug: "azure-cost-optimization",          provider: "Azure",       title: "Azure Cost Optimisation Cut Your Monthly Bill by 30%",                  saving: "20-40%",  keyword: "Azure cost optimization guide" },
  { slug: "fix-azure-vm-costs",               provider: "Azure",       title: "How to Reduce Azure VM Costs by 40% Immediately",                       saving: "15-40%",  keyword: "Reduce Azure VM costs" },
  { slug: "azure-reserved-instances",         provider: "Azure",       title: "Azure Reserved vs Pay-as-you-go Save 40% on VMs",                      saving: "20-45%",  keyword: "Azure Reserved Instances savings" },
  { slug: "azure-blob-storage-cost",          provider: "Azure",       title: "Cut Azure Blob Storage Costs 60% With Lifecycle Management",            saving: "30-60%",  keyword: "Reduce Azure Blob storage costs" },
  { slug: "azure-dev-staging-costs",          provider: "Azure",       title: "Azure Dev Staging Environments Stop the 24/7 Billing",                 saving: "40-70%",  keyword: "Azure dev environment too expensive" },
  { slug: "azure-advisor-cost-guide",         provider: "Azure",       title: "Azure Advisor Cost Recommendations What to Act On",                     saving: "10-30%",  keyword: "Azure Advisor cost savings" },
  { slug: "azure-hybrid-benefit",             provider: "Azure",       title: "Azure Hybrid Benefit Save Up to 85% on Windows VMs",                   saving: "40-85%",  keyword: "Azure Hybrid Benefit Windows savings" },
  { slug: "azure-spot-vms",                   provider: "Azure",       title: "Azure Spot VMs Run Workloads for 90% Less",                             saving: "60-90%",  keyword: "Azure Spot VMs cost saving" },
  { slug: "azure-storage-tiers",              provider: "Azure",       title: "Azure Blob Storage Tiers Move Cold Data and Save Immediately",          saving: "30-60%",  keyword: "Azure blob storage tier optimization" },
  { slug: "azure-cost-management-setup",      provider: "Azure",       title: "Azure Cost Management Budgets Alerts and Reports Setup",                saving: "5-20%",   keyword: "Azure cost management setup guide" },
  // Multi-cloud (5)
  { slug: "cloud-finops-guide",               provider: "Multi-Cloud", title: "The DevOps Teams FinOps Guide Cut Cloud Costs Without Slowing Down",    saving: "20-45%",  keyword: "Cloud FinOps guide teams" },
  { slug: "multi-cloud-cost-comparison",      provider: "Multi-Cloud", title: "AWS vs GCP vs Azure Cost Comparison for Common Workloads",              saving: "10-30%",  keyword: "AWS GCP Azure cost comparison" },
  { slug: "cloud-cost-tagging-strategy",      provider: "Multi-Cloud", title: "Cloud Cost Tagging Strategy Allocate Costs to Teams and Projects",      saving: "5-20%",   keyword: "Cloud cost tagging best practices" },
  { slug: "devops-cloud-cost-checklist",      provider: "Multi-Cloud", title: "DevOps Cloud Cost Checklist 20 Things to Review Every Quarter",         saving: "20-45%",  keyword: "DevOps cloud cost review checklist" },
  { slug: "finops-guide-startups",            provider: "Multi-Cloud", title: "FinOps for Startups Cut Cloud Costs Without Cutting Features",          saving: "20-45%",  keyword: "FinOps guide for startups" },
  // Blog posts (3)
  { slug: "blog/how-we-found-2400-month-cloud-waste",     provider: "AWS",         title: "How We Found $2,400/Month in Cloud Waste in 15 Minutes",                saving: null, keyword: "find cloud waste fast", type: "blog" },
  { slug: "blog/cloud-cost-audit-no-credentials",         provider: "Multi-Cloud", title: "How to Audit Cloud Costs Without Giving Anyone Your AWS Keys",          saving: null, keyword: "cloud cost audit no credentials", type: "blog" },
  { slug: "blog/finops-for-small-teams",                  provider: "Multi-Cloud", title: "FinOps for Small Teams: Cut Cloud Costs Without a Dedicated Engineer",   saving: null, keyword: "finops small team cloud costs", type: "blog" },

  // Problem-specific pages — engineers search for exact issues (20)
  { slug: "find-unattached-ebs-volumes-aws",        provider: "AWS",         title: "How to Find Unattached EBS Volumes in AWS and Delete Them",              saving: null, keyword: "find unattached EBS volumes AWS",               type: "problem", cmd: "aws ec2 describe-volumes --filters Name=status,Values=available --query Volumes --output table", saving_est: "$50-200/mo" },
  { slug: "find-idle-ec2-instances-aws",             provider: "AWS",         title: "How to Find Idle EC2 Instances Running at Under 5% CPU",                 saving: null, keyword: "find idle EC2 instances AWS CLI",                type: "problem", cmd: "aws cloudwatch get-metric-statistics --namespace AWS/EC2 --metric-name CPUUtilization --statistics Average", saving_est: "$150-400/mo" },
  { slug: "aws-nat-gateway-cost-high",               provider: "AWS",         title: "Why Is My AWS NAT Gateway Cost So High Fix It in 10 Minutes",            saving: null, keyword: "AWS NAT gateway cost too high fix",              type: "problem", cmd: "aws ec2 describe-nat-gateways --query NatGateways --output table", saving_est: "$100-300/mo" },
  { slug: "find-unused-elastic-ips-aws",             provider: "AWS",         title: "How to Find and Release Unused Elastic IPs in AWS",                      saving: null, keyword: "find unused elastic IPs AWS",                   type: "problem", cmd: "aws ec2 describe-addresses --query Addresses[?AssociationId==null] --output table", saving_est: "$3-15/mo each" },
  { slug: "aws-rds-dev-staging-running-24-7",        provider: "AWS",         title: "Stop AWS RDS Dev Staging Running 24/7 Auto-Shutdown Script",             saving: null, keyword: "AWS RDS dev staging auto shutdown cost",         type: "problem", cmd: "aws rds describe-db-instances --query DBInstances --output table", saving_est: "$200-600/mo" },
  { slug: "find-old-generation-ec2-instances",       provider: "AWS",         title: "Find m4 c4 r4 EC2 Instances Still Running Upgrade and Save 15 Percent", saving: null, keyword: "find old generation EC2 instances AWS",          type: "problem", cmd: "aws ec2 describe-instances --query Reservations --output table", saving_est: "$50-200/mo" },
  { slug: "aws-s3-find-public-buckets",              provider: "AWS",         title: "How to Find All Public S3 Buckets in Your AWS Account",                  saving: null, keyword: "find public S3 buckets AWS CLI audit",          type: "problem", cmd: "aws s3api list-buckets --query Buckets --output text", saving_est: null },
  { slug: "audit-iam-users-no-mfa-aws",              provider: "AWS",         title: "Find AWS IAM Users Without MFA Enabled Security Audit",                  saving: null, keyword: "find IAM users without MFA AWS",                type: "problem", cmd: "aws iam generate-credential-report && aws iam get-credential-report --output text", saving_est: null },
  { slug: "find-security-groups-open-to-internet",   provider: "AWS",         title: "Find AWS Security Groups Open to 0.0.0.0/0 Port 22 3389 443",           saving: null, keyword: "find security groups open 0.0.0.0/0 AWS",       type: "problem", cmd: "aws ec2 describe-security-groups --query SecurityGroups --output json", saving_est: null },
  { slug: "find-aws-snapshots-no-retention-policy",  provider: "AWS",         title: "Find AWS Snapshots Older Than 30 Days With No Lifecycle Policy",         saving: null, keyword: "AWS snapshots no retention policy cost",         type: "problem", cmd: "aws ec2 describe-snapshots --owner-ids self --output table", saving_est: "$30-100/mo" },
  { slug: "find-idle-gcp-vms",                       provider: "GCP",         title: "How to Find Idle GCP VM Instances Using gcloud CLI",                     saving: null, keyword: "find idle GCP VM instances CLI",                type: "problem", cmd: "gcloud compute instances list --format=table", saving_est: "$100-300/mo" },
  { slug: "gcp-nat-gateway-cost-high",               provider: "GCP",         title: "Why Is My GCP Cloud NAT Cost High Reduce It With These Steps",           saving: null, keyword: "GCP Cloud NAT cost too high reduce",            type: "problem", cmd: "gcloud compute routers list && gcloud compute routers get-nat-mapping-info ROUTER_NAME --region REGION", saving_est: "$50-200/mo" },
  { slug: "find-idle-azure-vms",                     provider: "Azure",       title: "How to Find Idle Azure VMs Using Azure CLI",                             saving: null, keyword: "find idle Azure VMs CLI audit",                 type: "problem", cmd: "az vm list --query [*].[name,powerState,location] --output table", saving_est: "$100-400/mo" },
  { slug: "find-unattached-azure-disks",             provider: "Azure",       title: "Find Unattached Azure Managed Disks Costing You Money",                  saving: null, keyword: "find unattached Azure disks CLI",               type: "problem", cmd: "az disk list --query [?diskState==Unattached] --output table", saving_est: "$20-100/mo" },
  { slug: "azure-nsg-open-port-22-audit",            provider: "Azure",       title: "Audit Azure NSGs With Port 22 Open to the Internet",                     saving: null, keyword: "Azure NSG port 22 open internet audit",         type: "problem", cmd: "az network nsg list --query [*].name --output tsv", saving_est: null },
  { slug: "cloud-cost-breakdown-by-service",         provider: "Multi-Cloud", title: "How to Get a Full Cloud Cost Breakdown by Service AWS GCP Azure",        saving: null, keyword: "cloud cost breakdown by service CLI",           type: "problem", cmd: "aws ce get-cost-and-usage --granularity MONTHLY --metrics BlendedCost --group-by Type=DIMENSION,Key=SERVICE", saving_est: "20-45%" },
  { slug: "terraform-find-unused-resources",         provider: "Multi-Cloud", title: "How to Find Unused Resources in Your Terraform State",                   saving: null, keyword: "terraform find unused resources",               type: "problem", cmd: "terraform state list | xargs -I {} terraform state show {}", saving_est: "$50-500/mo" },
  { slug: "kubernetes-find-idle-pods-cost",          provider: "Multi-Cloud", title: "Find Idle or Over-Provisioned Kubernetes Pods Wasting Money",            saving: null, keyword: "find idle Kubernetes pods cost optimization",   type: "problem", cmd: "kubectl top pods --all-namespaces --sort-by=cpu | head -20", saving_est: "$100-400/mo" },
  { slug: "how-to-set-aws-billing-alerts",           provider: "AWS",         title: "How to Set Up AWS Billing Alerts in 5 Minutes Never Get Surprised Again",saving: null, keyword: "setup AWS billing alerts CLI budget",           type: "problem", cmd: "aws budgets create-budget --account-id $(aws sts get-caller-identity --query Account --output text)", saving_est: "5-20%" },
  { slug: "find-cloud-resources-all-regions",        provider: "AWS",         title: "How to Find Cloud Resources Running in All Regions Stop Paying for Forgotten Resources", saving: null, keyword: "find cloud resources all AWS regions", type: "problem", cmd: "for region in $(aws ec2 describe-regions --query RegionsRegionName --output text); do aws ec2 describe-instances --region $region --output table; done", saving_est: "$50-300/mo" },
  // Security (10)
  { slug: "aws-iam-security-audit",           provider: "AWS",         title: "Free AWS IAM Security Audit Find Overprivileged Roles in 15 Minutes",   saving: null, keyword: "AWS IAM security audit checklist",     type: "security" },
  { slug: "aws-s3-public-bucket-fix",         provider: "AWS",         title: "Public S3 Buckets The Risk Hiding in Your AWS Account",                 saving: null, keyword: "AWS S3 public bucket security risk",   type: "security" },
  { slug: "aws-cloudtrail-setup",             provider: "AWS",         title: "How to Enable AWS CloudTrail Audit Logging in 5 Minutes",               saving: null, keyword: "AWS CloudTrail audit logging setup",   type: "security" },
  { slug: "aws-mfa-enforcement-guide",        provider: "AWS",         title: "Enforce MFA for Every AWS IAM User Step-by-Step Guide",                 saving: null, keyword: "Enforce MFA all AWS IAM users",        type: "security" },
  { slug: "aws-security-group-audit",         provider: "AWS",         title: "AWS Security Groups Open to the Internet Find and Fix Them",            saving: null, keyword: "AWS security group 0.0.0.0 risk",      type: "security" },
  { slug: "aws-secrets-manager-guide",        provider: "AWS",         title: "Hardcoded AWS Credentials How to Find and Eliminate Them",              saving: null, keyword: "Stop hardcoded AWS credentials code",  type: "security" },
  { slug: "gcp-iam-security-checklist",       provider: "GCP",         title: "GCP IAM Security Checklist 8 Things to Fix Before Your Next Audit",     saving: null, keyword: "GCP IAM security best practices",      type: "security" },
  { slug: "azure-security-posture-review",    provider: "Azure",       title: "Azure Security Posture Review No Access Required Checklist",            saving: null, keyword: "Azure security posture assessment",    type: "security" },
  { slug: "cloud-security-audit-checklist",   provider: "Multi-Cloud", title: "Cloud Security Audit Checklist 2026 16 Checks for AWS GCP and Azure",  saving: null, keyword: "Cloud security audit checklist 2026",  type: "security" },
  { slug: "devsecops-cloud-checklist",        provider: "Multi-Cloud", title: "DevSecOps Cloud Security Checklist 16 Controls Every Team Needs",       saving: null, keyword: "DevSecOps cloud security checklist",   type: "security" },
  // Comparison pages (4)
  { slug: "kloudaudit-vs-aws-cost-explorer",  provider: "AWS",         title: "KloudAudit vs AWS Cost Explorer: Which Finds More Waste in Less Time",    saving: "20-45%", keyword: "KloudAudit vs AWS Cost Explorer",             type: "comparison" },
  { slug: "kloudaudit-vs-cloudhealth",        provider: "Multi-Cloud", title: "KloudAudit vs CloudHealth: Zero-Access Audit vs Full Integration",         saving: "20-45%", keyword: "KloudAudit vs CloudHealth alternative",       type: "comparison" },
  { slug: "kloudaudit-vs-infracost",          provider: "Multi-Cloud", title: "KloudAudit vs Infracost: Runtime Waste Detection vs Pre-Deploy Estimates", saving: "20-45%", keyword: "KloudAudit vs Infracost cloud cost",          type: "comparison" },
  { slug: "best-aws-cost-audit-tool-2026",    provider: "AWS",         title: "Best AWS Cost Audit Tool 2026: Compared Without the Sales Demo",           saving: "20-45%", keyword: "best AWS cost audit tool 2026",               type: "comparison" },
];

let generated = 0;
for (const page of SEO_PAGES) {
  const url      = `${BASE}/${page.slug}/`;
  const isSecure     = page.type === 'security';
  const isBlog       = page.type === 'blog';
  const isProblem    = page.type === 'problem';
  const isComparison = page.type === 'comparison';
  const description = isSecure
    ? `${page.title}. Free interactive checklist complete in 15 minutes, no cloud credentials required. Used by engineers across AWS, GCP and Azure. KloudAudit.eu`
    : isProblem
    ? `${page.title}. Free CLI command to fix this — plus the full 18-check audit at kloudaudit.eu. No credentials required.`
    : isBlog
    ? `${page.title}. Practical cloud cost advice from KloudAudit — the zero-access cloud audit tool. kloudaudit.eu`
    : isComparison
    ? `${page.title}. Honest comparison — features, pricing, setup time, and who each tool is for. kloudaudit.eu`
    : `${page.title}. Typical savings: ${page.saving} of affected ${page.provider} spend. Free 15-minute audit at KloudAudit.eu, no cloud access required.`;

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

  const t = (s) => s.replace(/"/g, '&quot;');
  let html = indexHtml
    .replace(/<link rel="canonical"[^>]*>/g, '')
    .replace(/<title>.*?<\/title>/, `<title>${page.title} | KloudAudit</title>`)
    .replace(/<meta name="description"[^>]*\/>/, `<meta name="description" content="${t(description)}" />`)
    .replace(/<meta name="robots"[^>]*\/>/, `<meta name="robots" content="index, follow" />`)
    .replace(/<meta property="og:type"[^>]*\/>/, `<meta property="og:type" content="article" />`)
    .replace(/<meta property="og:url"[^>]*\/>/, `<meta property="og:url" content="${url}" />`)
    .replace(/<meta property="og:title"[^>]*\/>/, `<meta property="og:title" content="${t(page.title)} | KloudAudit" />`)
    .replace(/<meta property="og:description"[^>]*\/>/, `<meta property="og:description" content="${t(description)}" />`)
    .replace(/<meta name="twitter:title"[^>]*\/>/, `<meta name="twitter:title" content="${t(page.title)} | KloudAudit" />`)
    .replace(/<meta name="twitter:description"[^>]*\/>/, `<meta name="twitter:description" content="${t(description)}" />`)
    .replace(/\s*<\/head>/, () =>
      `\n  <link rel="canonical" href="${url}" />` +
      `\n  <script type="application/ld+json">${jsonLd}</script>` +
      `\n</head>`
    );

  const dir = path.join(DIST, page.slug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  generated++;
}

// ── PROBLEM PAGES — generate rich static HTML with CLI commands ──────────────
const PROBLEM_WHY = {
  'find-unattached-ebs-volumes-aws': 'Unattached EBS volumes continue billing even when no instance is using them. Each volume costs $0.10/GB/month on gp2. A single forgotten 500GB volume costs $50/month — and most accounts have dozens.',
  'find-idle-ec2-instances-aws': 'Idle EC2 instances running at under 5% CPU are one of the most common sources of cloud waste. A t3.large running 24/7 costs $60/month. Multiply that by 10 forgotten instances and you have $600/month in waste.',
  'aws-nat-gateway-cost-high': 'NAT Gateway charges $0.045 per GB of data processed. Traffic from EC2 to S3 or DynamoDB routed through NAT costs money that VPC endpoints eliminate entirely — at no data transfer cost.',
  'find-unused-elastic-ips-aws': 'AWS charges $0.005/hour (~$3.60/month) for every Elastic IP not attached to a running instance. Accounts accumulate these after instances are terminated but IPs are forgotten.',
  'aws-rds-dev-staging-running-24-7': 'A db.t3.medium RDS instance costs ~$50/month running 24/7. Stopped overnight (8pm–8am) and weekends, that drops to ~$18/month — a 64% reduction with a simple scheduled stop.',
  'find-old-generation-ec2-instances': 'M4, C4, and R4 instance families are 2-3 generations behind. M7g instances offer 15-20% better price/performance. Migration takes under an hour and saves immediately.',
  'aws-s3-find-public-buckets': 'Public S3 buckets are a critical security risk — they expose data to the internet. AWS has had multiple high-profile breaches from misconfigured buckets. This should be audited monthly.',
  'audit-iam-users-no-mfa-aws': 'IAM users without MFA are a single password compromise away from full account access. AWS accounts with root and IAM users lacking MFA are the most common entry point for cloud breaches.',
  'find-security-groups-open-to-internet': 'Security groups with 0.0.0.0/0 on port 22 (SSH) or 3389 (RDP) expose your instances to the entire internet. Automated scanners probe these continuously — it is a matter of when, not if.',
  'find-aws-snapshots-no-retention-policy': 'Without a lifecycle policy, snapshots accumulate indefinitely. At $0.05/GB/month, 10TB of old snapshots costs $500/month. Most of it is data from instances deleted months ago.',
  'find-idle-gcp-vms': 'GCP charges for VM instances even when they are sitting idle. Sustained use discounts only apply to running instances — stopped instances still charge for attached persistent disks.',
  'gcp-nat-gateway-cost-high': 'GCP Cloud NAT charges per NAT gateway hour plus per GB processed. Traffic to Google APIs routed through NAT is unnecessary — Private Google Access eliminates this cost.',
  'find-idle-azure-vms': 'Deallocated Azure VMs stop compute billing but continue charging for managed disks and static IPs. Truly idle VMs that are running accrue full compute costs regardless of workload.',
  'find-unattached-azure-disks': 'Azure managed disks continue billing when unattached. A P30 disk (1TB premium SSD) costs $135/month whether attached to a VM or sitting unused after the VM was deleted.',
  'azure-nsg-open-port-22-audit': 'Azure NSGs with port 22 open to any source (0.0.0.0/0 or *) expose VMs to SSH brute force attacks. This is one of the most common misconfigurations in Azure environments.',
  'cloud-cost-breakdown-by-service': 'Understanding which services drive your cloud bill is the first step to optimising it. Most teams are surprised to find 2-3 services account for over 80% of spend.',
  'terraform-find-unused-resources': 'Terraform state can contain resources that exist in the cloud but serve no active purpose. These accumulate over time as infrastructure evolves and old resources are forgotten.',
  'kubernetes-find-idle-pods-cost': 'Over-provisioned Kubernetes pods request more CPU and memory than they use. On managed clusters like EKS or GKE, this directly translates to node costs — you pay for requested resources, not actual usage.',
  'how-to-set-aws-billing-alerts': 'Without billing alerts, the first sign of a cost spike is the month-end bill. A budget alert at 80% of expected spend gives you time to investigate before costs spiral.',
  'find-cloud-resources-all-regions': 'Resources deployed in non-primary regions are frequently forgotten. A test EC2 instance in ap-southeast-2 can run for months before anyone notices — and AWS bills every region separately.',
};

const problemTemplate = fs.readFileSync(path.join(DIST, '..', 'public', 'problem-page-template.html'), 'utf8').catch ? null : null;
// Read template from public dir or use inline
let tmpl = '';
const tmplPath = path.join(__dirname, '..', 'public', 'problem-page-template.html');
if (fs.existsSync(tmplPath)) {
  tmpl = fs.readFileSync(tmplPath, 'utf8');
}

for (const page of SEO_PAGES.filter(p => p.type === 'problem')) {
  const url = `${BASE}/${page.slug}/`;
  const why = PROBLEM_WHY[page.slug] || `This is a common source of cloud waste for ${page.provider} teams.`;
  const cmd = page.cmd || '# Command varies by account configuration';

  if (tmpl) {
    const html = tmpl
      .replace(/PAGE_TITLE/g, page.title)
      .replace(/PAGE_URL/g, url)
      .replace(/PAGE_PROVIDER/g, page.provider)
      .replace(/PAGE_CMD/g, cmd)
      .replace(/PAGE_WHY/g, why)
      .replace(/PAGE_DESCRIPTION/g, `${page.title}. Free CLI command plus full 18-check audit at kloudaudit.eu — no credentials required.`);

    const dir = path.join(DIST, page.slug);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
  } else {
    // Fallback: use the same SPA approach as other pages
    const description = `${page.title}. Free CLI command to fix this — plus the full 18-check audit at kloudaudit.eu. No credentials required.`;
    const t = (s) => s.replace(/"/g, '&quot;');
    let html = indexHtml
      .replace(/<link rel="canonical"[^>]*>/g, '')
      .replace(/<title>.*?<\/title>/, `<title>${page.title} | KloudAudit</title>`)
      .replace(/<meta name="description"[^>]*\/>/, `<meta name="description" content="${t(description)}" />`)
      .replace(/\s*<\/head>/, () =>
        `\n  <link rel="canonical" href="${url}" />\n</head>`
      );
    const dir = path.join(DIST, page.slug);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
  }
}

// Fix homepage canonical + add FAQ and HowTo schema

// Fix homepage canonical + add FAQ and HowTo schema
const faqSchema = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    { "@type": "Question", "name": "Do you need access to my cloud account?",
      "acceptedAnswer": { "@type": "Answer", "text": "Never. Both audits are entirely self-guided — you answer questions based on your own knowledge. No credentials, no IAM roles, no agents, no OAuth." }},
    { "@type": "Question", "name": "How is the AI Blueprint different from the free report?",
      "acceptedAnswer": { "@type": "Answer", "text": "The free report tells you what is wrong. The Blueprint tells you exactly how to fix it — with CLI commands, Terraform snippets, IAM policy templates, and verification steps specific to your provider." }},
    { "@type": "Question", "name": "How fast do I receive the Blueprint?",
      "acceptedAnswer": { "@type": "Answer", "text": "Within 2 minutes of payment. Claude AI generates your personalised guide in ~30 seconds, then it is delivered to your inbox." }},
    { "@type": "Question", "name": "Is this a subscription?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. One-time payment — $79 for the Cost Blueprint, $29 for the Security Blueprint. You get a permanent document you implement at your own pace." }},
    { "@type": "Question", "name": "What cloud providers do you support?",
      "acceptedAnswer": { "@type": "Answer", "text": "AWS, GCP, Azure, and Multi-Cloud environments. The 18-check cost audit and 16-check security audit cover all major providers." }},
  ]
});

const howToSchema = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "How to audit your cloud costs in 15 minutes",
  "description": "A structured self-assessment to find 20-45% cloud waste without giving anyone your AWS credentials.",
  "totalTime": "PT15M",
  "step": [
    { "@type": "HowToStep", "name": "Select your cloud provider", "text": "Choose AWS, GCP, Azure, or Multi-Cloud." },
    { "@type": "HowToStep", "name": "Complete 18 audit checks", "text": "Answer questions about your infrastructure across compute, storage, network, database, and governance." },
    { "@type": "HowToStep", "name": "Get your Waste Score", "text": "Receive a personalised score from 0-100 with estimated monthly savings." },
    { "@type": "HowToStep", "name": "Get the AI Blueprint", "text": "Pay $79 to receive exact CLI commands and a 30-day remediation roadmap in your inbox within 2 minutes." },
  ]
});

const homepageHtml = indexHtml
  .replace(/<link rel="canonical"[^>]*>/g, '')
  .replace(/\s*<\/head>/, () =>
    `\n  <link rel="canonical" href="${BASE}/" />` +
    `\n  <script type="application/ld+json">${faqSchema}</script>` +
    `\n  <script type="application/ld+json">${howToSchema}</script>` +
    `\n</head>`
  );
fs.writeFileSync(path.join(DIST, 'index.html'), homepageHtml);

console.log('✅ Homepage canonical fixed');
console.log(`✅ Pre-rendered ${generated} SEO pages to dist/`);
console.log(`   Google will now read static HTML with correct meta tags for each page.`);
console.log(`   No more "redirect" or "canonical" indexing issues.`);
