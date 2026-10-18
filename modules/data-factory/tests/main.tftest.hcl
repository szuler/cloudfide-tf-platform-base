mock_provider "azurerm" {}

variables {
  name                       = "adf-test"
  resource_group_name        = "rg-test"
  location                   = "westeurope"
  log_analytics_workspace_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.OperationalInsights/workspaces/law-test"
}

run "default_log_categories_produces_two_enabled_log_blocks" {
  command = plan

  assert {
    condition     = length(azurerm_monitor_diagnostic_setting.this.enabled_log) == 2
    error_message = "Default diagnostic_log_categories must produce exactly 2 enabled_log blocks."
  }

  assert {
    condition     = toset([for l in azurerm_monitor_diagnostic_setting.this.enabled_log : l.category]) == toset(["ActivityRuns", "PipelineRuns"])
    error_message = "Default diagnostic categories must be ActivityRuns and PipelineRuns."
  }
}

run "custom_single_category_produces_one_enabled_log_block" {
  command = plan

  variables {
    diagnostic_log_categories = ["TriggerRuns"]
  }

  assert {
    condition     = length(azurerm_monitor_diagnostic_setting.this.enabled_log) == 1
    error_message = "A single diagnostic category must produce exactly 1 enabled_log block."
  }

  assert {
    condition     = toset([for l in azurerm_monitor_diagnostic_setting.this.enabled_log : l.category]) == toset(["TriggerRuns"])
    error_message = "The configured category TriggerRuns must be the sole enabled_log category."
  }
}

run "rejects_empty_diagnostic_log_categories" {
  command = plan

  variables {
    diagnostic_log_categories = []
  }

  expect_failures = [var.diagnostic_log_categories]
}

run "linked_storage_creates_one_linked_service_per_account" {
  command = plan

  variables {
    linked_storage_accounts = {
      adls = "https://myaccount.dfs.core.windows.net"
    }
  }

  assert {
    condition     = length(azurerm_data_factory_linked_service_data_lake_storage_gen2.this) == 1
    error_message = "One linked storage account input must produce exactly one linked service resource."
  }

  assert {
    condition     = azurerm_data_factory_linked_service_data_lake_storage_gen2.this["adls"].use_managed_identity == true
    error_message = "Linked services must always authenticate using managed identity."
  }

  assert {
    condition     = azurerm_data_factory_linked_service_data_lake_storage_gen2.this["adls"].url == "https://myaccount.dfs.core.windows.net"
    error_message = "Linked service URL must match the input DFS endpoint (each.value wiring)."
  }
}

run "no_linked_storage_accounts_creates_no_linked_services" {
  command = plan

  assert {
    condition     = length(azurerm_data_factory_linked_service_data_lake_storage_gen2.this) == 0
    error_message = "Default empty linked_storage_accounts must produce no linked service resources."
  }
}
