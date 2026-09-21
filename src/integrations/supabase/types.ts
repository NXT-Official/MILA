export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      ai_spend_log: {
        Row: {
          completion_tokens: number | null;
          cost_usd: number | null;
          created_at: string;
          id: string;
          metadata: Json | null;
          model: string;
          prompt_tokens: number | null;
          provider: string;
          total_tokens: number | null;
          user_id: string | null;
        };
        Insert: {
          completion_tokens?: number | null;
          cost_usd?: number | null;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          model: string;
          prompt_tokens?: number | null;
          provider: string;
          total_tokens?: number | null;
          user_id?: string | null;
        };
        Update: {
          completion_tokens?: number | null;
          cost_usd?: number | null;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          model?: string;
          prompt_tokens?: number | null;
          provider?: string;
          total_tokens?: number | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_spend_log_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      brands: {
        Row: {
          affiliate_network: string | null;
          commission_rate: number | null;
          created_at: string;
          id: string;
          is_verified_seller: boolean;
          logo_url: string | null;
          name: string;
          status: string;
          updated_at: string;
          website_url: string | null;
        };
        Insert: {
          affiliate_network?: string | null;
          commission_rate?: number | null;
          created_at?: string;
          id?: string;
          is_verified_seller?: boolean;
          logo_url?: string | null;
          name: string;
          status?: string;
          updated_at?: string;
          website_url?: string | null;
        };
        Update: {
          affiliate_network?: string | null;
          commission_rate?: number | null;
          created_at?: string;
          id?: string;
          is_verified_seller?: boolean;
          logo_url?: string | null;
          name?: string;
          status?: string;
          updated_at?: string;
          website_url?: string | null;
        };
        Relationships: [];
      };
      concierge_conversations: {
        Row: {
          created_at: string;
          id: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "concierge_conversations_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      concierge_messages: {
        Row: {
          content: string;
          conversation_id: string;
          created_at: string;
          id: string;
          image_url: string | null;
          role: string;
          user_id: string;
        };
        Insert: {
          content: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          image_url?: string | null;
          role: string;
          user_id: string;
        };
        Update: {
          content?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          image_url?: string | null;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "concierge_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "concierge_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "concierge_messages_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      outfits: {
        Row: {
          analysis_result: Json | null;
          created_at: string;
          id: string;
          image_url: string;
          match_score: number | null;
          user_id: string;
        };
        Insert: {
          analysis_result?: Json | null;
          created_at?: string;
          id?: string;
          image_url: string;
          match_score?: number | null;
          user_id: string;
        };
        Update: {
          analysis_result?: Json | null;
          created_at?: string;
          id?: string;
          image_url?: string;
          match_score?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "outfits_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      post_items: {
        Row: {
          attributes: Json;
          bbox: Json;
          category: string;
          created_at: string;
          id: string;
          label: string;
          post_id: string;
          product_id: string | null;
          source_url: string | null;
        };
        Insert: {
          attributes: Json;
          bbox: Json;
          category: string;
          created_at?: string;
          id?: string;
          label: string;
          post_id: string;
          product_id?: string | null;
          source_url?: string | null;
        };
        Update: {
          attributes?: Json;
          bbox?: Json;
          category?: string;
          created_at?: string;
          id?: string;
          label?: string;
          post_id?: string;
          product_id?: string | null;
          source_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "post_items_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      posts: {
        Row: {
          caption: string | null;
          created_at: string;
          generated_look_id: string | null;
          hidden: boolean;
          hidden_at: string | null;
          hidden_reason: string | null;
          id: string;
          image_url_back: string;
          image_url_front: string;
          user_id: string;
        };
        Insert: {
          caption?: string | null;
          created_at?: string;
          generated_look_id?: string | null;
          hidden?: boolean;
          hidden_at?: string | null;
          hidden_reason?: string | null;
          id?: string;
          image_url_back: string;
          image_url_front: string;
          user_id: string;
        };
        Update: {
          caption?: string | null;
          created_at?: string;
          generated_look_id?: string | null;
          hidden?: boolean;
          hidden_at?: string | null;
          hidden_reason?: string | null;
          id?: string;
          image_url_back?: string;
          image_url_front?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "posts_generated_look_id_fkey";
            columns: ["generated_look_id"];
            isOneToOne: false;
            referencedRelation: "outfits";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          affiliate_link: string;
          available_regions: string[];
          body_shapes: string[];
          brand_id: string;
          category: string;
          currency: string;
          date_added: string;
          description: string | null;
          discount_percent: number | null;
          gender: string;
          id: string;
          image_url: string | null;
          in_stock: boolean;
          last_verified_at: string | null;
          price: number;
          rating: number | null;
          seasonal_palettes: string[];
          shipping_info: string | null;
          title: string;
          units_sold: number | null;
          verification_status: string;
        };
        Insert: {
          affiliate_link: string;
          available_regions?: string[];
          body_shapes?: string[];
          brand_id: string;
          category: string;
          currency?: string;
          date_added?: string;
          description?: string | null;
          discount_percent?: number | null;
          gender?: string;
          id?: string;
          image_url?: string | null;
          in_stock?: boolean;
          last_verified_at?: string | null;
          price?: number;
          rating?: number | null;
          seasonal_palettes?: string[];
          shipping_info?: string | null;
          title: string;
          units_sold?: number | null;
          verification_status?: string;
        };
        Update: {
          affiliate_link?: string;
          available_regions?: string[];
          body_shapes?: string[];
          brand_id?: string;
          category?: string;
          currency?: string;
          date_added?: string;
          description?: string | null;
          discount_percent?: number | null;
          gender?: string;
          id?: string;
          image_url?: string | null;
          in_stock?: boolean;
          last_verified_at?: string | null;
          price?: number;
          rating?: number | null;
          seasonal_palettes?: string[];
          shipping_info?: string | null;
          title?: string;
          units_sold?: number | null;
          verification_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          beauty_preferences: Json;
          body_type: string | null;
          color_profile: Json | null;
          color_season: string | null;
          created_at: string;
          default_location: string | null;
          delivery_country: string | null;
          face_shape: string | null;
          full_name: string | null;
          gender: string | null;
          hair_length: string | null;
          hair_type: string | null;
          height_cm: number | null;
          id: string;
          makeup_preference: string;
          paddle_customer_id: string | null;
          photo_consent_at: string | null;
          profile_photo_path: string | null;
          shopping_preferences: Json;
          skin_depth: string | null;
          skin_undertone: string | null;
          style_goals: string[];
          styling_constraints: Json;
          suspended: boolean;
          updated_at: string;
          username: string | null;
          weight_kg: number | null;
        };
        Insert: {
          beauty_preferences?: Json;
          body_type?: string | null;
          color_profile?: Json | null;
          color_season?: string | null;
          created_at?: string;
          default_location?: string | null;
          delivery_country?: string | null;
          face_shape?: string | null;
          full_name?: string | null;
          gender?: string | null;
          hair_length?: string | null;
          hair_type?: string | null;
          height_cm?: number | null;
          id: string;
          makeup_preference?: string;
          paddle_customer_id?: string | null;
          photo_consent_at?: string | null;
          profile_photo_path?: string | null;
          shopping_preferences?: Json;
          skin_depth?: string | null;
          skin_undertone?: string | null;
          style_goals?: string[];
          styling_constraints?: Json;
          suspended?: boolean;
          updated_at?: string;
          username?: string | null;
          weight_kg?: number | null;
        };
        Update: {
          beauty_preferences?: Json;
          body_type?: string | null;
          color_profile?: Json | null;
          color_season?: string | null;
          created_at?: string;
          default_location?: string | null;
          delivery_country?: string | null;
          face_shape?: string | null;
          full_name?: string | null;
          gender?: string | null;
          hair_length?: string | null;
          hair_type?: string | null;
          height_cm?: number | null;
          id?: string;
          makeup_preference?: string;
          paddle_customer_id?: string | null;
          photo_consent_at?: string | null;
          profile_photo_path?: string | null;
          shopping_preferences?: Json;
          skin_depth?: string | null;
          skin_undertone?: string | null;
          style_goals?: string[];
          styling_constraints?: Json;
          suspended?: boolean;
          updated_at?: string;
          username?: string | null;
          weight_kg?: number | null;
        };
        Relationships: [];
      };
      purchases: {
        Row: {
          amount_cents: number;
          created_at: string;
          currency: string;
          id: string;
          metadata: Json | null;
          product_id: string;
          status: string;
          user_id: string | null;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          currency?: string;
          id?: string;
          metadata?: Json | null;
          product_id: string;
          status?: string;
          user_id?: string | null;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          metadata?: Json | null;
          product_id?: string;
          status?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      rate_limit_buckets: {
        Row: {
          count: number;
          expires_at: string | null;
          key: string;
          window_start: string;
        };
        Insert: {
          count?: number;
          expires_at?: string | null;
          key: string;
          window_start: string;
        };
        Update: {
          count?: number;
          expires_at?: string | null;
          key?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      saved_palettes: {
        Row: {
          created_at: string;
          id: string;
          palette: Json;
          style_vibe: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          palette: Json;
          style_vibe: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          palette?: Json;
          style_vibe?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_palettes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_audit_log: {
        Row: {
          action: string;
          actor_user_id: string;
          created_at: string;
          id: string;
          metadata: Json;
          target_id: string | null;
          target_type: string;
          target_user_id: string | null;
        };
        Insert: {
          action: string;
          actor_user_id: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          target_id?: string | null;
          target_type: string;
          target_user_id?: string | null;
        };
        Update: {
          action?: string;
          actor_user_id?: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          target_id?: string | null;
          target_type?: string;
          target_user_id?: string | null;
        };
        Relationships: [];
      };
      subscription_plans: {
        Row: {
          archived_at: string | null;
          billing_interval: string;
          created_at: string;
          credits_included: number;
          currency: string;
          description: string;
          features: string[];
          id: string;
          is_active: boolean;
          is_featured: boolean;
          paddle_price_id: string | null;
          paddle_product_id: string | null;
          price_amount: number;
          slug: string;
          sort_order: number;
          title: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          billing_interval?: string;
          created_at?: string;
          credits_included?: number;
          currency?: string;
          description?: string;
          features?: string[];
          id?: string;
          is_active?: boolean;
          is_featured?: boolean;
          paddle_price_id?: string | null;
          paddle_product_id?: string | null;
          price_amount?: number;
          slug: string;
          sort_order?: number;
          title: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          billing_interval?: string;
          created_at?: string;
          credits_included?: number;
          currency?: string;
          description?: string;
          features?: string[];
          id?: string;
          is_active?: boolean;
          is_featured?: boolean;
          paddle_price_id?: string | null;
          paddle_product_id?: string | null;
          price_amount?: number;
          slug?: string;
          sort_order?: number;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean;
          created_at: string;
          current_period_end: string | null;
          id: string;
          paddle_customer_id: string;
          paddle_subscription_id: string;
          plan_id: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          paddle_customer_id: string;
          paddle_subscription_id: string;
          plan_id: string;
          status: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          paddle_customer_id?: string;
          paddle_subscription_id?: string;
          plan_id?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "subscription_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      support_messages: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          message: string;
          resolved: boolean;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: string;
          message: string;
          resolved?: boolean;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          message?: string;
          resolved?: boolean;
        };
        Relationships: [];
      };
      user_entitlements: {
        Row: {
          ai_credits: number;
          created_at: string;
          credits_reset_at: string | null;
          look_image_pending: boolean;
          purchased_credits: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          ai_credits?: number;
          created_at?: string;
          credits_reset_at?: string | null;
          look_image_pending?: boolean;
          purchased_credits?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          ai_credits?: number;
          created_at?: string;
          credits_reset_at?: string | null;
          look_image_pending?: boolean;
          purchased_credits?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_favorites: {
        Row: {
          created_at: string;
          id: string;
          product_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          product_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          product_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_favorites_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      check_rate_limit: {
        Args: {
          _cost?: number;
          _key: string;
          _limit: number;
          _window_seconds: number;
        };
        Returns: {
          allowed: boolean;
          remaining: number;
          reset_at: string;
          retry_after_seconds: number;
        }[];
      };
      consume_ai_credit: {
        Args: { _daily_allowance: number; _user_id: string };
        Returns: {
          allowed: boolean;
          remaining: number;
        }[];
      };
      derive_username: {
        Args: { desired: string; email: string };
        Returns: string;
      };
      grant_ai_credits: {
        Args: { _amount: number; _daily_allowance: number; _user_id: string };
        Returns: number;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      manage_user_role: {
        Args: {
          _actor_user_id: string;
          _grant: boolean;
          _role: Database["public"]["Enums"]["app_role"];
          _target_user_id: string;
        };
        Returns: string;
      };
      set_user_suspended: {
        Args: {
          _actor_user_id: string;
          _suspended: boolean;
          _target_user_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "admin" | "moderator" | "user";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const;
