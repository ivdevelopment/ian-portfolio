
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "admin_users": {
                  Row: {
                    "created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"client_previews": {
                  Row: {
                    "access_code_hash": string,"access_count": number,"active": boolean,"client_name": string,"created_at": string,"expires_at": string | null,"first_accessed_at": string | null,"id": string,"last_accessed_at": string | null,"notes": string | null,"project_name": string,"session_ttl_hours": number,"session_version": number,"subdomain": string,"successful_access_count": number,"target_url": string,"updated_at": string,"upstream_auth_type": string,"upstream_header_name": string | null,"upstream_secret_ref": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "access_code_hash": string,"access_count"?: number,"active"?: boolean,"client_name": string,"created_at"?: string,"expires_at"?: string | null,"first_accessed_at"?: string | null,"id"?: string,"last_accessed_at"?: string | null,"notes"?: string | null,"project_name": string,"session_ttl_hours"?: number,"session_version"?: number,"subdomain": string,"successful_access_count"?: number,"target_url": string,"updated_at"?: string,"upstream_auth_type"?: string,"upstream_header_name"?: string | null,"upstream_secret_ref"?: string | null
                  }
                  Update: {
                    "access_code_hash"?: string,"access_count"?: number,"active"?: boolean,"client_name"?: string,"created_at"?: string,"expires_at"?: string | null,"first_accessed_at"?: string | null,"id"?: string,"last_accessed_at"?: string | null,"notes"?: string | null,"project_name"?: string,"session_ttl_hours"?: number,"session_version"?: number,"subdomain"?: string,"successful_access_count"?: number,"target_url"?: string,"updated_at"?: string,"upstream_auth_type"?: string,"upstream_header_name"?: string | null,"upstream_secret_ref"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"inquiries": {
                  Row: {
                    "budget": string,"created_at": string,"email": string,"id": string,"ip_hash": string | null,"message": string,"name": string,"project_type": string,"status": Database["public"]['Enums']["inquiry_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "budget": string,"created_at"?: string,"email": string,"id"?: string,"ip_hash"?: string | null,"message": string,"name": string,"project_type": string,"status"?: Database["public"]['Enums']["inquiry_status"],"updated_at"?: string
                  }
                  Update: {
                    "budget"?: string,"created_at"?: string,"email"?: string,"id"?: string,"ip_hash"?: string | null,"message"?: string,"name"?: string,"project_type"?: string,"status"?: Database["public"]['Enums']["inquiry_status"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"mail_connections": {
                  Row: {
                    "account_email": string,"connected_at": string,"connected_by": string | null,"data_center": string,"id": string,"last_sync_at": string | null,"provider": string,"provider_account_id": string,"refresh_token_encrypted": string,"scopes": string,"status": string,"sync_from": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_email": string,"connected_at"?: string,"connected_by"?: string | null,"data_center": string,"id"?: string,"last_sync_at"?: string | null,"provider"?: string,"provider_account_id": string,"refresh_token_encrypted": string,"scopes": string,"status"?: string,"sync_from"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_email"?: string,"connected_at"?: string,"connected_by"?: string | null,"data_center"?: string,"id"?: string,"last_sync_at"?: string | null,"provider"?: string,"provider_account_id"?: string,"refresh_token_encrypted"?: string,"scopes"?: string,"status"?: string,"sync_from"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"mail_messages": {
                  Row: {
                    "cc_addresses": (string)[],"connection_id": string,"direction": string,"folder_id": string | null,"from_address": string,"id": string,"prospect_id": string | null,"provider_message_id": string,"provider_thread_id": string | null,"sent_at": string,"snippet": string | null,"subject": string | null,"synced_at": string,"to_addresses": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "cc_addresses"?: (string)[],"connection_id": string,"direction": string,"folder_id"?: string | null,"from_address": string,"id"?: string,"prospect_id"?: string | null,"provider_message_id": string,"provider_thread_id"?: string | null,"sent_at": string,"snippet"?: string | null,"subject"?: string | null,"synced_at"?: string,"to_addresses"?: (string)[]
                  }
                  Update: {
                    "cc_addresses"?: (string)[],"connection_id"?: string,"direction"?: string,"folder_id"?: string | null,"from_address"?: string,"id"?: string,"prospect_id"?: string | null,"provider_message_id"?: string,"provider_thread_id"?: string | null,"sent_at"?: string,"snippet"?: string | null,"subject"?: string | null,"synced_at"?: string,"to_addresses"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "mail_messages_connection_id_fkey"
      columns: ["connection_id"]
isOneToOne: false
      referencedRelation: "mail_connections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mail_messages_prospect_id_fkey"
      columns: ["prospect_id"]
isOneToOne: false
      referencedRelation: "prospects"
      referencedColumns: ["id"]
    }
                  ]
                },"mail_sync_runs": {
                  Row: {
                    "connection_id": string,"errors": NonNullable<Json>,"finished_at": string | null,"id": string,"messages_checked": number,"messages_matched": number,"messages_stored": number,"mode": string,"preview": NonNullable<Json>,"started_at": string,"window_from": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "connection_id": string,"errors"?: NonNullable<Json>,"finished_at"?: string | null,"id"?: string,"messages_checked"?: number,"messages_matched"?: number,"messages_stored"?: number,"mode": string,"preview"?: NonNullable<Json>,"started_at"?: string,"window_from"?: string | null
                  }
                  Update: {
                    "connection_id"?: string,"errors"?: NonNullable<Json>,"finished_at"?: string | null,"id"?: string,"messages_checked"?: number,"messages_matched"?: number,"messages_stored"?: number,"mode"?: string,"preview"?: NonNullable<Json>,"started_at"?: string,"window_from"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "mail_sync_runs_connection_id_fkey"
      columns: ["connection_id"]
isOneToOne: false
      referencedRelation: "mail_connections"
      referencedColumns: ["id"]
    }
                  ]
                },"preview_access_attempts": {
                  Row: {
                    "attempted_at": string,"id": number,"ip_hash": string,"preview_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempted_at"?: string,"id"?: never,"ip_hash": string,"preview_id": string
                  }
                  Update: {
                    "attempted_at"?: string,"id"?: never,"ip_hash"?: string,"preview_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "preview_access_attempts_preview_id_fkey"
      columns: ["preview_id"]
isOneToOne: false
      referencedRelation: "client_previews"
      referencedColumns: ["id"]
    }
                  ]
                },"project_features": {
                  Row: {
                    "id": string,"label": string,"project_id": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"label": string,"project_id": string,"sort_order"?: number
                  }
                  Update: {
                    "id"?: string,"label"?: string,"project_id"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_features_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"project_media": {
                  Row: {
                    "alt": string | null,"created_at": string,"external_url": string | null,"id": string,"poster_path": string | null,"project_id": string,"sort_order": number,"storage_path": string | null,"type": Database["public"]['Enums']["media_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "alt"?: string | null,"created_at"?: string,"external_url"?: string | null,"id"?: string,"poster_path"?: string | null,"project_id": string,"sort_order"?: number,"storage_path"?: string | null,"type": Database["public"]['Enums']["media_type"]
                  }
                  Update: {
                    "alt"?: string | null,"created_at"?: string,"external_url"?: string | null,"id"?: string,"poster_path"?: string | null,"project_id"?: string,"sort_order"?: number,"storage_path"?: string | null,"type"?: Database["public"]['Enums']["media_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_media_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "category": string,"client": string | null,"created_at": string,"description": string | null,"featured": boolean,"github_url": string | null,"id": string,"is_example": boolean,"kind": Database["public"]['Enums']["project_kind"],"live_url": string | null,"preview_mode": Database["public"]['Enums']["preview_mode"],"preview_url": string | null,"project_type": Database["public"]['Enums']["project_type"] | null,"published": boolean,"published_at": string | null,"short_description": string,"slug": string,"sort_order": number,"subtitle": string | null,"tags": (string)[],"technologies": (string)[],"thumbnail_path": string | null,"title": string,"translations": NonNullable<Json>,"updated_at": string,"year": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"client"?: string | null,"created_at"?: string,"description"?: string | null,"featured"?: boolean,"github_url"?: string | null,"id"?: string,"is_example"?: boolean,"kind"?: Database["public"]['Enums']["project_kind"],"live_url"?: string | null,"preview_mode"?: Database["public"]['Enums']["preview_mode"],"preview_url"?: string | null,"project_type"?: Database["public"]['Enums']["project_type"] | null,"published"?: boolean,"published_at"?: string | null,"short_description": string,"slug": string,"sort_order"?: number,"subtitle"?: string | null,"tags"?: (string)[],"technologies"?: (string)[],"thumbnail_path"?: string | null,"title": string,"translations"?: NonNullable<Json>,"updated_at"?: string,"year"?: number | null
                  }
                  Update: {
                    "category"?: string,"client"?: string | null,"created_at"?: string,"description"?: string | null,"featured"?: boolean,"github_url"?: string | null,"id"?: string,"is_example"?: boolean,"kind"?: Database["public"]['Enums']["project_kind"],"live_url"?: string | null,"preview_mode"?: Database["public"]['Enums']["preview_mode"],"preview_url"?: string | null,"project_type"?: Database["public"]['Enums']["project_type"] | null,"published"?: boolean,"published_at"?: string | null,"short_description"?: string,"slug"?: string,"sort_order"?: number,"subtitle"?: string | null,"tags"?: (string)[],"technologies"?: (string)[],"thumbnail_path"?: string | null,"title"?: string,"translations"?: NonNullable<Json>,"updated_at"?: string,"year"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"prospect_activities": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"metadata": NonNullable<Json>,"occurred_at": string | null,"occurred_on": string,"prospect_id": string,"title": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"metadata"?: NonNullable<Json>,"occurred_at"?: string | null,"occurred_on"?: string,"prospect_id": string,"title": string,"type": string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"metadata"?: NonNullable<Json>,"occurred_at"?: string | null,"occurred_on"?: string,"prospect_id"?: string,"title"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "prospect_activities_prospect_id_fkey"
      columns: ["prospect_id"]
isOneToOne: false
      referencedRelation: "prospects"
      referencedColumns: ["id"]
    }
                  ]
                },"prospect_imports": {
                  Row: {
                    "created_at": string,"created_by": string | null,"duplicates": number,"file_name": string | null,"id": string,"rows_imported": number,"rows_parsed": number,"rows_skipped": number,"source": string,"warnings": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"duplicates"?: number,"file_name"?: string | null,"id"?: string,"rows_imported": number,"rows_parsed": number,"rows_skipped": number,"source": string,"warnings"?: NonNullable<Json>
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"duplicates"?: number,"file_name"?: string | null,"id"?: string,"rows_imported"?: number,"rows_parsed"?: number,"rows_skipped"?: number,"source"?: string,"warnings"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"prospects": {
                  Row: {
                    "city": string | null,"company_name": string,"contact_delivery_status": string,"contact_name": string | null,"created_at": string,"email": string | null,"estimated_value_eur": number | null,"first_contact_on": string | null,"id": string,"last_activity_on": string | null,"last_activity_title": string | null,"last_contact_on": string | null,"legacy_ref": string | null,"linked_preview_id": string | null,"linked_project_id": string | null,"next_follow_up_on": string | null,"notes": string | null,"phone": string | null,"priority": string,"priority_order": number | null,"quote_value_eur": number | null,"sector": string | null,"source": string | null,"status": string,"status_order": number | null,"updated_at": string,"website_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "city"?: string | null,"company_name": string,"contact_delivery_status"?: string,"contact_name"?: string | null,"created_at"?: string,"email"?: string | null,"estimated_value_eur"?: number | null,"first_contact_on"?: string | null,"id"?: string,"last_activity_on"?: string | null,"last_activity_title"?: string | null,"last_contact_on"?: string | null,"legacy_ref"?: string | null,"linked_preview_id"?: string | null,"linked_project_id"?: string | null,"next_follow_up_on"?: string | null,"notes"?: string | null,"phone"?: string | null,"priority"?: string,"priority_order"?: never,"quote_value_eur"?: number | null,"sector"?: string | null,"source"?: string | null,"status"?: string,"status_order"?: never,"updated_at"?: string,"website_url"?: string | null
                  }
                  Update: {
                    "city"?: string | null,"company_name"?: string,"contact_delivery_status"?: string,"contact_name"?: string | null,"created_at"?: string,"email"?: string | null,"estimated_value_eur"?: number | null,"first_contact_on"?: string | null,"id"?: string,"last_activity_on"?: string | null,"last_activity_title"?: string | null,"last_contact_on"?: string | null,"legacy_ref"?: string | null,"linked_preview_id"?: string | null,"linked_project_id"?: string | null,"next_follow_up_on"?: string | null,"notes"?: string | null,"phone"?: string | null,"priority"?: string,"priority_order"?: never,"quote_value_eur"?: number | null,"sector"?: string | null,"source"?: string | null,"status"?: string,"status_order"?: never,"updated_at"?: string,"website_url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "prospects_linked_preview_id_fkey"
      columns: ["linked_preview_id"]
isOneToOne: false
      referencedRelation: "client_previews"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "prospects_linked_project_id_fkey"
      columns: ["linked_project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"quote_activities": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"id": string,"metadata": NonNullable<Json>,"quote_id": string,"title": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"metadata"?: NonNullable<Json>,"quote_id": string,"title": string,"type": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"metadata"?: NonNullable<Json>,"quote_id"?: string,"title"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_activities_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id"]
    }
                  ]
                },"quote_counters": {
                  Row: {
                    "last_number": number,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "last_number": number,"year": number
                  }
                  Update: {
                    "last_number"?: number,"year"?: number
                  }
                  Relationships: [
                    
                  ]
                },"quote_item_templates": {
                  Row: {
                    "active": boolean,"created_at": string,"default_tax_rate": number,"default_unit": string | null,"default_unit_price": number | null,"description": string | null,"id": string,"name": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"default_tax_rate"?: number,"default_unit"?: string | null,"default_unit_price"?: number | null,"description"?: string | null,"id"?: string,"name": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"default_tax_rate"?: number,"default_unit"?: string | null,"default_unit_price"?: number | null,"description"?: string | null,"id"?: string,"name"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"quote_items": {
                  Row: {
                    "created_at": string,"description": string | null,"discount_percent": number,"id": string,"line_subtotal": number,"line_tax": number,"line_total": number,"position": number,"quantity": number,"quote_discount_share": number,"quote_id": string,"tax_rate": number,"template_id": string | null,"title": string,"unit": string | null,"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"discount_percent"?: number,"id"?: string,"line_subtotal": number,"line_tax": number,"line_total": number,"position": number,"quantity": number,"quote_discount_share"?: number,"quote_id": string,"tax_rate"?: number,"template_id"?: string | null,"title": string,"unit"?: string | null,"unit_price": number
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"discount_percent"?: number,"id"?: string,"line_subtotal"?: number,"line_tax"?: number,"line_total"?: number,"position"?: number,"quantity"?: number,"quote_discount_share"?: number,"quote_id"?: string,"tax_rate"?: number,"template_id"?: string | null,"title"?: string,"unit"?: string | null,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_items_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quote_items_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "quote_item_templates"
      referencedColumns: ["id"]
    }
                  ]
                },"quote_settings": {
                  Row: {
                    "business_address": string | null,"business_email": string | null,"business_iban": string | null,"business_name": string,"business_phone": string | null,"business_tagline": string | null,"business_vat_number": string | null,"business_website": string | null,"default_intro": string | null,"default_language": string,"default_tax_rate": number,"default_terms": string | null,"default_validity_days": number,"id": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_address"?: string | null,"business_email"?: string | null,"business_iban"?: string | null,"business_name"?: string,"business_phone"?: string | null,"business_tagline"?: string | null,"business_vat_number"?: string | null,"business_website"?: string | null,"default_intro"?: string | null,"default_language"?: string,"default_tax_rate"?: number,"default_terms"?: string | null,"default_validity_days"?: number,"id"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "business_address"?: string | null,"business_email"?: string | null,"business_iban"?: string | null,"business_name"?: string,"business_phone"?: string | null,"business_tagline"?: string | null,"business_vat_number"?: string | null,"business_website"?: string | null,"default_intro"?: string | null,"default_language"?: string,"default_tax_rate"?: number,"default_terms"?: string | null,"default_validity_days"?: number,"id"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"quotes": {
                  Row: {
                    "accepted_at": string | null,"client_address": string | null,"client_company": string | null,"client_email": string | null,"client_name": string | null,"created_at": string,"currency": string,"discount_total": number,"discount_type": string,"discount_value": number,"id": string,"intro": string | null,"language": string,"notes": string | null,"project_id": string | null,"prospect_id": string | null,"quote_number": string,"rejected_at": string | null,"sent_at": string | null,"status": string,"status_note": string | null,"subtotal": number,"tax_total": number,"terms": string | null,"title": string | null,"total": number,"updated_at": string,"valid_until": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"client_address"?: string | null,"client_company"?: string | null,"client_email"?: string | null,"client_name"?: string | null,"created_at"?: string,"currency"?: string,"discount_total"?: number,"discount_type"?: string,"discount_value"?: number,"id"?: string,"intro"?: string | null,"language"?: string,"notes"?: string | null,"project_id"?: string | null,"prospect_id"?: string | null,"quote_number": string,"rejected_at"?: string | null,"sent_at"?: string | null,"status"?: string,"status_note"?: string | null,"subtotal"?: number,"tax_total"?: number,"terms"?: string | null,"title"?: string | null,"total"?: number,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Update: {
                    "accepted_at"?: string | null,"client_address"?: string | null,"client_company"?: string | null,"client_email"?: string | null,"client_name"?: string | null,"created_at"?: string,"currency"?: string,"discount_total"?: number,"discount_type"?: string,"discount_value"?: number,"id"?: string,"intro"?: string | null,"language"?: string,"notes"?: string | null,"project_id"?: string | null,"prospect_id"?: string | null,"quote_number"?: string,"rejected_at"?: string | null,"sent_at"?: string | null,"status"?: string,"status_note"?: string | null,"subtotal"?: number,"tax_total"?: number,"terms"?: string | null,"title"?: string | null,"total"?: number,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotes_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotes_prospect_id_fkey"
      columns: ["prospect_id"]
isOneToOne: false
      referencedRelation: "prospects"
      referencedColumns: ["id"]
    }
                  ]
                },"review_invitations": {
                  Row: {
                    "client_name": string | null,"created_at": string,"created_by": string,"email": string | null,"expires_at": string,"id": string,"project_id": string | null,"review_id": string | null,"revoked_at": string | null,"token_hash": string,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "client_name"?: string | null,"created_at"?: string,"created_by": string,"email"?: string | null,"expires_at": string,"id"?: string,"project_id"?: string | null,"review_id"?: string | null,"revoked_at"?: string | null,"token_hash": string,"used_at"?: string | null
                  }
                  Update: {
                    "client_name"?: string | null,"created_at"?: string,"created_by"?: string,"email"?: string | null,"expires_at"?: string,"id"?: string,"project_id"?: string | null,"review_id"?: string | null,"revoked_at"?: string | null,"token_hash"?: string,"used_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "review_invitations_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "review_invitations_review_id_fkey"
      columns: ["review_id"]
isOneToOne: false
      referencedRelation: "reviews"
      referencedColumns: ["id"]
    }
                  ]
                },"review_private": {
                  Row: {
                    "created_at": string,"ip_hash": string | null,"original_review_text": string,"review_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ip_hash"?: string | null,"original_review_text": string,"review_id": string
                  }
                  Update: {
                    "created_at"?: string,"ip_hash"?: string | null,"original_review_text"?: string,"review_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "review_private_review_id_fkey"
      columns: ["review_id"]
isOneToOne: true
      referencedRelation: "reviews"
      referencedColumns: ["id"]
    }
                  ]
                },"reviews": {
                  Row: {
                    "avatar_path": string | null,"company": string | null,"created_at": string,"featured": boolean,"id": string,"name": string,"project_id": string | null,"published_at": string | null,"rating": number,"review_text": string,"role": string | null,"sort_order": number,"source": Database["public"]['Enums']["review_source"],"status": Database["public"]['Enums']["review_status"],"submitted_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_path"?: string | null,"company"?: string | null,"created_at"?: string,"featured"?: boolean,"id"?: string,"name": string,"project_id"?: string | null,"published_at"?: string | null,"rating": number,"review_text": string,"role"?: string | null,"sort_order"?: number,"source": Database["public"]['Enums']["review_source"],"status"?: Database["public"]['Enums']["review_status"],"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "avatar_path"?: string | null,"company"?: string | null,"created_at"?: string,"featured"?: boolean,"id"?: string,"name"?: string,"project_id"?: string | null,"published_at"?: string | null,"rating"?: number,"review_text"?: string,"role"?: string | null,"sort_order"?: number,"source"?: Database["public"]['Enums']["review_source"],"status"?: Database["public"]['Enums']["review_status"],"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reviews_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"services": {
                  Row: {
                    "created_at": string,"description": string,"enabled": boolean,"icon": string,"id": string,"includes": (string)[],"slug": string,"sort_order": number,"title": string,"translations": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description": string,"enabled"?: boolean,"icon"?: string,"id"?: string,"includes"?: (string)[],"slug": string,"sort_order"?: number,"title": string,"translations"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"enabled"?: boolean,"icon"?: string,"id"?: string,"includes"?: (string)[],"slug"?: string,"sort_order"?: number,"title"?: string,"translations"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"site_content": {
                  Row: {
                    "content": NonNullable<Json>,"key": string,"translations": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content": NonNullable<Json>,"key": string,"translations"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "content"?: NonNullable<Json>,"key"?: string,"translations"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"site_settings": {
                  Row: {
                    "contact_email": string | null,"display_name": string,"github_url": string | null,"id": boolean,"instagram_url": string | null,"linkedin_url": string | null,"location": string | null,"seo_default_description": string,"seo_default_title": string,"seo_og_title": string | null,"seo_title_template": string,"site_name": string,"translations": NonNullable<Json>,"updated_at": string,"x_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "contact_email"?: string | null,"display_name": string,"github_url"?: string | null,"id"?: boolean,"instagram_url"?: string | null,"linkedin_url"?: string | null,"location"?: string | null,"seo_default_description": string,"seo_default_title": string,"seo_og_title"?: string | null,"seo_title_template": string,"site_name": string,"translations"?: NonNullable<Json>,"updated_at"?: string,"x_url"?: string | null
                  }
                  Update: {
                    "contact_email"?: string | null,"display_name"?: string,"github_url"?: string | null,"id"?: boolean,"instagram_url"?: string | null,"linkedin_url"?: string | null,"location"?: string | null,"seo_default_description"?: string,"seo_default_title"?: string,"seo_og_title"?: string | null,"seo_title_template"?: string,"site_name"?: string,"translations"?: NonNullable<Json>,"updated_at"?: string,"x_url"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"skills": {
                  Row: {
                    "created_at": string,"enabled": boolean,"icon": string | null,"id": string,"name": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"enabled"?: boolean,"icon"?: string | null,"id"?: string,"name": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"enabled"?: boolean,"icon"?: string | null,"id"?: string,"name"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "allocate_quote_number":
{ Args: { "p_year": number }; Returns: string
                           },
"create_client_preview":
{ Args: { "p_client_name": string,"p_code": string,"p_expires_at": string,"p_notes": string,"p_project_name": string,"p_session_ttl_hours": number,"p_subdomain": string,"p_target_url": string }; Returns: string
                           },
"create_quote":
{ Args: { "p_items": Json,"p_quote": Json }; Returns: string
                           },
"duplicate_quote":
{ Args: { "p_id": string }; Returns: string
                           },
"get_review_invitation":
{ Args: { "p_token_hash": string }; Returns: Json
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"preview_gate":
{ Args: { "p_subdomain": string }; Returns: Json
                           },
"preview_upstream":
{ Args: { "p_id": string,"p_session_version": number }; Returns: Json
                           },
"prospect_summary":
{ Args: { "p_today": string,"p_week_end": string }; Returns: Json
                           },
"quotes_assert_consistent":
{ Args: { "p_quote_id": string }; Returns: undefined
                           },
"quotes_write_items":
{ Args: { "p_items": Json,"p_quote_id": string }; Returns: undefined
                           },
"reset_preview_access_code":
{ Args: { "p_code": string,"p_id": string }; Returns: undefined
                           },
"save_project":
{ Args: { "p_features": Json,"p_id": string,"p_media": Json,"p_project": Json }; Returns: string
                           },
"save_services":
{ Args: { "p_services": Json }; Returns: undefined
                           },
"save_skills":
{ Args: { "p_skills": Json }; Returns: undefined
                           },
"submit_inquiry":
{ Args: { "p_budget": string,"p_email": string,"p_ip_hash"?: string,"p_message": string,"p_name": string,"p_project_type": string }; Returns: string
                           },
"submit_review":
{ Args: { "p_company": string,"p_ip_hash"?: string,"p_name": string,"p_rating": number,"p_role": string,"p_text": string,"p_token_hash": string }; Returns: string
                           },
"update_quote":
{ Args: { "p_expected_updated_at": string,"p_id": string,"p_items": Json,"p_quote": Json }; Returns: string
                           },
"verify_preview_access":
{ Args: { "p_code": string,"p_ip_hash": string,"p_subdomain": string }; Returns: Json
                           }
          }
          Enums: {
            "inquiry_status": "new"|"contacted"|"qualified"|"won"|"lost"|"archived","media_type": "image"|"gif"|"video","preview_mode": "embed"|"media"|"external","project_kind": "website"|"web-app"|"redesign"|"concept","project_type": "client"|"personal"|"concept","review_source": "admin"|"invitation","review_status": "pending"|"approved"|"rejected"|"archived"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "inquiry_status": ["new", "contacted", "qualified", "won", "lost", "archived"],"media_type": ["image", "gif", "video"],"preview_mode": ["embed", "media", "external"],"project_kind": ["website", "web-app", "redesign", "concept"],"project_type": ["client", "personal", "concept"],"review_source": ["admin", "invitation"],"review_status": ["pending", "approved", "rejected", "archived"]
          }
        }
} as const
