variable "name" {
  description = "Name of the data factory."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group that holds the factory."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "public_network_enabled" {
  description = "Allow access to the data factory from the public internet."
  type        = bool
  default     = true
}

variable "log_analytics_workspace_id" {
  description = "Log Analytics workspace that receives the factory's diagnostic logs."
  type        = string
}

variable "diagnostic_log_categories" {
  description = "Diagnostic log categories the factory sends to the Log Analytics workspace."
  type        = set(string)
  default     = ["ActivityRuns", "PipelineRuns"]

  validation {
    condition     = length(var.diagnostic_log_categories) > 0
    error_message = "At least one diagnostic log category must be enabled."
  }
}

variable "linked_storage_accounts" {
  description = "Data lake accounts to link, by a short key. The value is the account's DFS endpoint."
  type        = map(string)
  default     = {}
}

variable "tags" {
  description = "Tags for all resources."
  type        = map(string)
  default     = {}
}
