export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      ad_events: {
        Row: {
          ad_type: string;
          created_at: string;
          event: string;
          id: string;
          metadata: Json | null;
          placement: string | null;
          reward_amount: number | null;
          reward_type: string | null;
          user_id: string;
        };
        Insert: {
          ad_type: string;
          created_at?: string;
          event: string;
          id?: string;
          metadata?: Json | null;
          placement?: string | null;
          reward_amount?: number | null;
          reward_type?: string | null;
          user_id: string;
        };
        Update: {
          ad_type?: string;
          created_at?: string;
          event?: string;
          id?: string;
          metadata?: Json | null;
          placement?: string | null;
          reward_amount?: number | null;
          reward_type?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      brands: {
        Row: {
          affiliate_network: string | null;
          commission_rate: number | null;
          created_at: string;
          id: string;
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
        Relationships: [];
      };
      products: {
        Row: {
          affiliate_link: string;
          body_shapes: string[];
          brand_id: string;
          category: string;
          currency: string;
          date_added: string;
          description: string | null;
          id: string;
          image_url: string | null;
          price: number;
          seasonal_palettes: string[];
          title: string;
        };
        Insert: {
          affiliate_link: string;
          body_shapes?: string[];
          brand_id: string;
          category: string;
          currency?: string;
          date_added?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          price?: number;
          seasonal_palettes?: string[];
          title: string;
        };
        Update: {
          affiliate_link?: string;
          body_shapes?: string[];
          brand_id?: string;
          category?: string;
          currency?: string;
          date_added?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          price?: number;
          seasonal_palettes?: string[];
          title?: string;
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
          face_shape: string | null;
          full_name: string | null;
          hair_type: string | null;
          id: string;
          skin_undertone: string | null;
          suspended: boolean;
          updated_at: string;
          username: string | null;
        };
        Insert: {
          beauty_preferences?: Json;
          body_type?: string | null;
          color_profile?: Json | null;
          color_season?: string | null;
          created_at?: string;
          default_location?: string | null;
          face_shape?: string | null;
          full_name?: string | null;
          hair_type?: string | null;
          id: string;
          skin_undertone?: string | null;
          suspended?: boolean;
          updated_at?: string;
          username?: string | null;
        };
        Update: {
          beauty_preferences?: Json;
          body_type?: string | null;
          color_profile?: Json | null;
          color_season?: string | null;
          created_at?: string;
          default_location?: string | null;
          face_shape?: string | null;
          full_name?: string | null;
          hair_type?: string | null;
          id?: string;
          skin_undertone?: string | null;
          suspended?: boolean;
          updated_at?: string;
          username?: string | null;
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
          user_id: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          currency?: string;
          id?: string;
          metadata?: Json | null;
          product_id: string;
          status?: string;
          user_id: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          metadata?: Json | null;
          product_id?: string;
          status?: string;
          user_id?: string;
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
          price_amount?: number;
          slug?: string;
          sort_order?: number;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
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
          ads_removed: boolean;
          ai_credits: number;
          created_at: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          ads_removed?: boolean;
          ai_credits?: number;
          created_at?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          ads_removed?: boolean;
          ai_credits?: number;
          created_at?: string;
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
      rate_limit_buckets: {
        Row: {
          count: number;
          key: string;
          window_start: string;
        };
        Insert: {
          count?: number;
          key: string;
          window_start: string;
        };
        Update: {
          count?: number;
          key?: string;
          window_start?: string;
        };
        Relationships: [];
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
          _key: string;
          _limit: number;
          _window_seconds: number;
          _cost?: number;
        };
        Returns: {
          allowed: boolean;
          remaining: number;
          reset_at: string;
          retry_after_seconds: number;
        }[];
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
