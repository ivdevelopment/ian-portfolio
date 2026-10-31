
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
                    "access_code_hash": string,"access_count": number,"active": boolean,"client_name": string,"created_at": string,"expires_at": string | null,"id": string,"last_accessed_at": string | null,"notes": string | null,"project_name": string,"session_ttl_hours": number,"session_version": number,"subdomain": string,"target_url": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_code_hash": string,"access_count"?: number,"active"?: boolean,"client_name": string,"created_at"?: string,"expires_at"?: string | null,"id"?: string,"last_accessed_at"?: string | null,"notes"?: string | null,"project_name": string,"session_ttl_hours"?: number,"session_version"?: number,"subdomain": string,"target_url": string,"updated_at"?: string
                  }
                  Update: {
                    "access_code_hash"?: string,"access_count"?: number,"active"?: boolean,"client_name"?: string,"created_at"?: string,"expires_at"?: string | null,"id"?: string,"last_accessed_at"?: string | null,"notes"?: string | null,"project_name"?: string,"session_ttl_hours"?: number,"session_version"?: number,"subdomain"?: string,"target_url"?: string,"updated_at"?: string
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
            "create_client_preview":
{ Args: { "p_client_name": string,"p_code": string,"p_expires_at": string,"p_notes": string,"p_project_name": string,"p_session_ttl_hours": number,"p_subdomain": string,"p_target_url": string }; Returns: string
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
"preview_target":
{ Args: { "p_id": string,"p_session_version": number }; Returns: string
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
