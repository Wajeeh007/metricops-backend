import { z } from "zod";

export const awsAssumeRoleConfigurationSchema = z.object({
  roleArn: z.string().regex(/^arn:(?:aws|aws-us-gov|aws-cn):iam::[0-9]{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/),
  externalId: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9+=,.@:_\/-]+$/),
  regions: z.array(z.string().regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/)).min(1).max(20).refine((values) => new Set(values).size === values.length),
  resourceTypes: z.array(z.enum(["aws_ec2", "aws_ebs", "aws_rds", "aws_load_balancer"])).min(1).max(4).refine((values) => new Set(values).size === values.length),
  maxResources: z.number().int().min(1).max(5000).default(1000),
}).strict();
