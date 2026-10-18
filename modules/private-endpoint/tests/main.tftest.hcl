mock_provider "azurerm" {}

variables {
  name                = "myendpoint"
  resource_group_name = "rg-test"
  location            = "westeurope"
  subnet_id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/virtualNetworks/vnet/subnets/snet"
  target_resource_id  = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Storage/storageAccounts/sttest"
  subresource_name    = "blob"
}

# Verify the new network_interface_name variable defaults to null (Azure assigns the NIC name).
run "nic_name_defaults_to_null" {
  command = plan

  assert {
    condition     = azurerm_private_endpoint.this.custom_network_interface_name == null
    error_message = "network_interface_name defaults to null; custom_network_interface_name must not be set when the caller omits it"
  }
}

# Verify a caller-supplied NIC name is forwarded to the Azure resource.
run "nic_name_forwarded_when_provided" {
  command = plan

  variables {
    network_interface_name = "nic-pe-myendpoint"
  }

  assert {
    condition     = azurerm_private_endpoint.this.custom_network_interface_name == "nic-pe-myendpoint"
    error_message = "network_interface_name must be forwarded verbatim to custom_network_interface_name"
  }
}

# Verify the endpoint and PSC names follow the pe-/psc- naming convention.
run "resource_names_follow_convention" {
  command = plan

  assert {
    condition     = azurerm_private_endpoint.this.name == "pe-myendpoint"
    error_message = "endpoint name must be pe-<var.name>"
  }

  assert {
    condition     = azurerm_private_endpoint.this.private_service_connection[0].name == "psc-myendpoint"
    error_message = "private service connection name must be psc-<var.name>"
  }
}

# Without private_dns_zone_id the dynamic block must produce no DNS zone group.
run "dns_zone_group_absent_without_zone_id" {
  command = plan

  assert {
    condition     = length(azurerm_private_endpoint.this.private_dns_zone_group) == 0
    error_message = "private_dns_zone_group must not be created when private_dns_zone_id is null"
  }
}

# With private_dns_zone_id the dynamic block must produce exactly one DNS zone group.
run "dns_zone_group_present_with_zone_id" {
  command = plan

  variables {
    private_dns_zone_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-dns/providers/Microsoft.Network/privateDnsZones/privatelink.blob.core.windows.net"
  }

  assert {
    condition     = length(azurerm_private_endpoint.this.private_dns_zone_group) == 1
    error_message = "exactly one private_dns_zone_group must be created when private_dns_zone_id is set"
  }

  assert {
    condition     = azurerm_private_endpoint.this.private_dns_zone_group[0].private_dns_zone_ids[0] == "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-dns/providers/Microsoft.Network/privateDnsZones/privatelink.blob.core.windows.net"
    error_message = "the provided private_dns_zone_id must be wired verbatim into the zone group"
  }
}

# Guard: auto-approval must never be changed to manual — a manual connection requires
# explicit operator approval before traffic flows, which is a silent operational risk.
run "connection_is_not_manual" {
  command = plan

  assert {
    condition     = azurerm_private_endpoint.this.private_service_connection[0].is_manual_connection == false
    error_message = "is_manual_connection must remain false; switching to manual silently blocks traffic until a human approves the connection"
  }
}

# Verify caller-supplied tags are propagated to the endpoint resource.
run "tags_are_applied" {
  command = plan

  variables {
    tags = { env = "test", team = "platform" }
  }

  assert {
    condition     = azurerm_private_endpoint.this.tags["env"] == "test"
    error_message = "caller tags must be forwarded to the endpoint resource"
  }

  assert {
    condition     = azurerm_private_endpoint.this.tags["team"] == "platform"
    error_message = "all caller tags must be forwarded to the endpoint resource"
  }
}
