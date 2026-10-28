
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
                    "category": string,"client": string | null,"created_at": string,"description": string | null,"featured": boolean,"github_url": string | null,"id": string,"is_example": boolean,"kind": Database["public"]['Enums']["project_kind"],"live_url": string | null,"preview_mode": Database["public"]['Enums']["preview_mode"],"preview_url": string | null,"project_type": Database["public"]['Enums']["project_type"] | null,"published": boolean,"published_at": string | null,"short_description": string,"slug": string,"sort_order": number,"subtitle": string | null,"tags": (string)[],"technologies": (string)[],"thumbnail_path": string | null,"title": string,"updated_at": string,"year": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"client"?: string | null,"created_at"?: string,"description"?: string | null,"featured"?: boolean,"github_url"?: string | null,"id"?: string,"is_example"?: boolean,"kind"?: Database["public"]['Enums']["project_kind"],"live_url"?: string | null,"preview_mode"?: Database["public"]['Enums']["preview_mode"],"preview_url"?: string | null,"project_type"?: Database["public"]['Enums']["project_type"] | null,"published"?: boolean,"published_at"?: string | null,"short_description": string,"slug": string,"sort_order"?: number,"subtitle"?: string | null,"tags"?: (string)[],"technologies"?: (string)[],"thumbnail_path"?: string | null,"title": string,"updated_at"?: string,"year"?: number | null
                  }
                  Update: {
                    "category"?: string,"client"?: string | null,"created_at"?: string,"description"?: string | null,"featured"?: boolean,"github_url"?: string | null,"id"?: string,"is_example"?: boolean,"kind"?: Database["public"]['Enums']["project_kind"],"live_url"?: string | null,"preview_mode"?: Database["public"]['Enums']["preview_mode"],"preview_url"?: string | null,"project_type"?: Database["public"]['Enums']["project_type"] | null,"published"?: boolean,"published_at"?: string | null,"short_description"?: string,"slug"?: string,"sort_order"?: number,"subtitle"?: string | null,"tags"?: (string)[],"technologies"?: (string)[],"thumbnail_path"?: string | null,"title"?: string,"updated_at"?: string,"year"?: number | null
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"save_project":
{ Args: { "p_features": Json,"p_id": string,"p_media": Json,"p_project": Json }; Returns: string
                           },
"submit_inquiry":
{ Args: { "p_budget": string,"p_email": string,"p_ip_hash"?: string,"p_message": string,"p_name": string,"p_project_type": string }; Returns: string
                           }
          }
          Enums: {
            "inquiry_status": "new"|"contacted"|"qualified"|"won"|"lost"|"archived","media_type": "image"|"gif"|"video","preview_mode": "embed"|"media"|"external","project_kind": "website"|"web-app"|"redesign"|"concept","project_type": "client"|"personal"|"concept"
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
            "inquiry_status": ["new", "contacted", "qualified", "won", "lost", "archived"],"media_type": ["image", "gif", "video"],"preview_mode": ["embed", "media", "external"],"project_kind": ["website", "web-app", "redesign", "concept"],"project_type": ["client", "personal", "concept"]
          }
        }
} as const
